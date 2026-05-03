import express from "express";
import { Webhooks } from "@octokit/webhooks";
import { getOctokit, postReview } from "./github.js";
import { parseDiff } from "./diffParser.js";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

const app = express();
app.use(
  express.json({
    verify: (req, _res, buf) => {
      (req as any).rawBody = buf.toString();
    },
  }),
);

if (!process.env.GITHUB_APP_ID || !process.env.GITHUB_WEBHOOK_SECRET) {
  console.error("❌ Missing GITHUB_APP_ID or GITHUB_WEBHOOK_SECRET in .env");
  process.exit(1);
}

const webhooks = new Webhooks({
  secret: process.env.GITHUB_WEBHOOK_SECRET,
});

const getHeader = (val: string | string[] | undefined): string => {
  if (Array.isArray(val)) return val[0];
  return val ?? "";
};

const allowedEvents = [
  "push",
  "pull_request",
  "issues",
  "issue_comment",
  "repository",
] as const;

type AllowedEvent = (typeof allowedEvents)[number];

function isWebhookEventName(name: string): name is AllowedEvent {
  return allowedEvents.includes(name as AllowedEvent);
}

type Hunk = { start: number; end: number };
type Change = { file: string; hunks: Hunk[] };
type Finding = {
  file: string;
  line: number;
  rule: string;
  severity: "warning" | "error" | "info";
  message: string;
};

const MAX_CONCURRENT = 3;
const MAX_QUEUE = 50;
const queue: Array<() => void> = [];
let running = 0;

const installationRuns = new Map<number, number[]>();
const INSTALLATION_HOURLY_LIMIT = 10;
const ONE_HOUR_MS = 60 * 60 * 1000;

function enqueueJob(
  job: () => Promise<void>,
  onDrop: () => Promise<void>,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = () => {
      running++;

      void (async () => {
        try {
          await job();
          resolve();
        } catch (err) {
          reject(err);
        } finally {
          running--;
          drainQueue();
        }
      })();
    };

    if (running < MAX_CONCURRENT) {
      start();
      return;
    }

    if (queue.length >= MAX_QUEUE) {
      void onDrop().finally(() => resolve());
      return;
    }

    queue.push(start);
  });
}

function drainQueue() {
  while (running < MAX_CONCURRENT && queue.length > 0) {
    const start = queue.shift();
    if (start) start();
  }
}

function allowInstallationJob(installationId: number): boolean {
  const now = Date.now();
  const windowStart = now - ONE_HOUR_MS;
  const runs = installationRuns.get(installationId) ?? [];
  const recent = runs.filter((t) => t >= windowStart);

  if (recent.length >= INSTALLATION_HOURLY_LIMIT) {
    installationRuns.set(installationId, recent);
    return false;
  }

  recent.push(now);
  installationRuns.set(installationId, recent);
  return true;
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "");
}

function isInChangedRange(line: number, hunks: Hunk[]): boolean {
  return hunks.some((h) => line >= h.start && line <= h.end);
}

function filterFindingsByDiff(findings: Finding[], changes: Change[]): Finding[] {
  const hunksMap = new Map<string, Hunk[]>();
  for (const change of changes) {
    hunksMap.set(normalizePath(change.file), change.hunks);
  }

  return findings.filter((finding) => {
    const hunks = hunksMap.get(normalizePath(finding.file)) ?? [];
    return isInChangedRange(finding.line, hunks);
  });
}

function isAllowedFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return [".js", ".jsx", ".ts", ".tsx"].includes(ext);
}

async function postComment(
  octokit: Awaited<ReturnType<typeof getOctokit>>,
  owner: string,
  repo: string,
  issue_number: number,
  body: string,
) {
  await octokit.rest.issues.createComment({
    owner,
    repo,
    issue_number,
    body,
  });
}

async function makeTempDir(jobId: string): Promise<string> {
  const tmpDir = path.join(
    os.tmpdir(),
    `ghreview-${jobId}-${crypto.randomUUID()}`,
  );
  await fs.mkdir(tmpDir, { recursive: true });
  return tmpDir;
}

async function removeTempDir(tmpDir: string): Promise<void> {
  await fs.rm(tmpDir, { recursive: true, force: true });
}

function safeResolveWithinRoot(root: string, relativePath: string): string {
  const target = path.resolve(root, relativePath);
  const normalizedRoot = root.endsWith(path.sep) ? root : root + path.sep;

  if (!target.startsWith(normalizedRoot)) {
    throw new Error(`Path traversal attempt blocked: ${relativePath}`);
  }

  return target;
}

async function writeChangedFilesToTempDir(
  octokit: Awaited<ReturnType<typeof getOctokit>>,
  owner: string,
  repo: string,
  ref: string,
  changes: Change[],
  tmpDir: string,
): Promise<Change[]> {
  const keptChanges: Change[] = [];

  for (const change of changes) {
    const relativePath = normalizePath(change.file);

    if (!isAllowedFile(relativePath)) {
      continue;
    }

    const res = await octokit.rest.repos.getContent({
      owner,
      repo,
      path: relativePath,
      ref,
    });

    if (Array.isArray(res.data)) {
      continue;
    }

    if (res.data.type !== "file" || !res.data.content) {
      continue;
    }

    const targetPath = safeResolveWithinRoot(tmpDir, relativePath);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });

    const content = Buffer.from(res.data.content, "base64").toString("utf8");
    await fs.writeFile(targetPath, content, "utf8");

    keptChanges.push({
      file: relativePath,
      hunks: change.hunks,
    });
  }

  return keptChanges;
}

function runProcess(
  command: string,
  args: string[],
  cwd: string,
  signal: AbortSignal,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      signal,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);

    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

async function runSemgrep(tmpDir: string): Promise<Finding[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);

  const args = [
    "-u",
    "semgrep-runner",
    "semgrep",
    "--config=p/javascript",
    "--config=p/typescript",
    "--no-git-ignore",
    "--no-dereference-symlinks",
    "--disable-version-check",
    "--json",
    "--max-memory=512",
    "--timeout=30",
    '--include=*.js',
    '--include=*.ts',
    '--include=*.jsx',
    '--include=*.tsx',
    '--exclude=.env*',
    '--exclude=*.min.js',
    '--exclude=node_modules',
    '--exclude=dist',
    '--exclude=build',
    tmpDir,
  ];

  try {
    const { code, stdout, stderr } = await runProcess(
      "sudo",
      args,
      tmpDir,
      controller.signal,
    );

    if (code !== 0 && code !== 1) {
      throw new Error(stderr || stdout || `Semgrep failed with code ${code}`);
    }

    if (!stdout.trim()) {
      return [];
    }

    const parsed = JSON.parse(stdout) as {
      results?: Array<{
        path: string;
        start?: { line?: number };
        check_id?: string;
        extra?: { message?: string; severity?: string };
      }>;
    };

    return (parsed.results ?? [])
      .filter((r) => typeof r.start?.line === "number")
      .map((r) => ({
        file: normalizePath(r.path),
        line: r.start!.line!,
        rule: r.check_id ?? "semgrep-rule",
        severity:
          r.extra?.severity === "error"
            ? "error"
            : r.extra?.severity === "info"
              ? "info"
              : "warning",
        message: r.extra?.message ?? "Semgrep finding",
      }));
  } finally {
    clearTimeout(timeout);
  }
}

async function analyzePullRequest(
  octokit: Awaited<ReturnType<typeof getOctokit>>,
  owner: string,
  repo: string,
  prNumber: number,
  headSha: string,
) {
  const repoInfo = await octokit.rest.repos.get({ owner, repo });

  if (repoInfo.data.size > 102_400) {
    await postComment(
      octokit,
      owner,
      repo,
      prNumber,
      "Repo exceeds 100MB limit — skipping analysis.",
    );
    return;
  }

  const filesRes = await octokit.rest.pulls.listFiles({
    owner,
    repo,
    pull_number: prNumber,
  });

  let files = filesRes.data;

  if (files.length > 15) {
    files = files.sort((a, b) => b.changes - a.changes).slice(0, 5);
    console.log("⚠️ Large PR detected, limiting to top 5 files");
  }

  const changes = parseDiff(files);

  if (changes.length === 0) {
    console.log("ℹ️ No analyzable code changes");
    return;
  }

  const jobId = `${owner}-${repo}-${prNumber}`;
  const tmpDir = await makeTempDir(jobId);

  try {
    const keptChanges = await writeChangedFilesToTempDir(
      octokit,
      owner,
      repo,
      headSha,
      changes,
      tmpDir,
    );

    if (keptChanges.length === 0) {
      console.log("ℹ️ No supported files to scan");
      return;
    }

    const rawFindings = await runSemgrep(tmpDir);
    const findings = filterFindingsByDiff(rawFindings, keptChanges);

    if (findings.length > 0) {
      await postReview(octokit, {
        owner,
        repo,
        pull_number: prNumber,
        findings,
      });
    } else {
      console.log("No violations found. Skipping review.");
    }

    console.log("🔍 Findings:");
    console.log(JSON.stringify(findings, null, 2));
  } finally {
    await removeTempDir(tmpDir);
  }
}

app.post("/webhook", async (req, res) => {
  const event = getHeader(req.headers["x-github-event"]);
  const signature = getHeader(req.headers["x-hub-signature-256"]);
  const deliveryId = getHeader(req.headers["x-github-delivery"]);

  if (!event || !signature) {
    console.error("❌ Missing event or signature headers");
    return res.sendStatus(400);
  }

  try {
    await webhooks.verify((req as any).rawBody, signature);
    res.sendStatus(200);

    setImmediate(() => {
      if (!isWebhookEventName(event)) {
        console.error("❌ Unsupported event:", event);
        return;
      }

      void webhooks.receive({
        id: deliveryId,
        name: event,
        payload: req.body,
      }).catch((err) => {
        console.error(
          "❌ Webhook processing error:",
          err instanceof Error ? err.message : String(err),
        );
      });
    });
  } catch (err) {
    console.error(
      "❌ Webhook error:",
      err instanceof Error ? err.message : String(err),
    );
    return res.sendStatus(401);
  }
});

webhooks.on("pull_request.opened", async ({ payload }) => {
  const { repository, pull_request, installation } = payload;

  if (!installation) {
    console.log("⚠️ No installation ID found");
    return;
  }

  const owner = repository.owner.login;
  const repo = repository.name;
  const prNumber = pull_request.number;
  const installationId = installation.id;

  if (!allowInstallationJob(installationId)) {
    await postComment(
      await getOctokit(installationId),
      owner,
      repo,
      prNumber,
      "Analysis limit reached for this installation — try again later.",
    );
    return;
  }

  await enqueueJob(
    async () => {
      console.log(`📦 PR opened: ${owner}/${repo} #${prNumber}`);
      const octokit = await getOctokit(installationId);
      await analyzePullRequest(
        octokit,
        owner,
        repo,
        prNumber,
        pull_request.head.sha,
      );
    },
    async () => {
      const octokit = await getOctokit(installationId);
      await postComment(
        octokit,
        owner,
        repo,
        prNumber,
        "Analysis queue is full right now — please retry shortly.",
      );
    },
  );
});

app.listen(7860, () => {
  console.log("🚀 Server running on port 7860");
});