import { App } from "@octokit/app";
import { Octokit } from "@octokit/rest";
import process from "process";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

const { GITHUB_APP_ID, GITHUB_WEBHOOK_SECRET, GITHUB_PRIVATE_KEY } =
  process.env;

if (!GITHUB_APP_ID || !GITHUB_WEBHOOK_SECRET || !GITHUB_PRIVATE_KEY) {
  console.error("❌ Missing required GitHub environment variables");
  process.exit(1);
}

const app = new App({
  appId: GITHUB_APP_ID,
  privateKey: GITHUB_PRIVATE_KEY.replace(/\\n/g, "\n"),
  Octokit,
});

export async function getOctokit(
  installationId: number,
): Promise<Octokit> {
  return app.getInstallationOctokit(installationId);
}

// 🔒 Strong typing
export interface Finding {
  file: string;
  line: number;
  rule: string;
  message: string;
  severity?: "warning" | "error" | "info";
}

export async function postReview(
  octokit: Octokit,
  {
    owner,
    repo,
    pull_number,
    findings,
  }: {
    owner: string;
    repo: string;
    pull_number: number;
    findings: Finding[];
  },
) {
  if (findings.length === 0) return;

  // ⚠️ GitHub hard limit ~300 comments per review
  const MAX_COMMENTS = 50;
  const trimmed = findings.slice(0, MAX_COMMENTS);

  const comments = trimmed.map((f) => ({
    path: f.file,
    line: f.line,
    body: formatComment(f),
  }));

  try {
    await octokit.rest.pulls.createReview({
      owner,
      repo,
      pull_number,
      event: "COMMENT",
      body: buildSummary(findings.length),
      comments,
    });

    console.log(`✅ Review posted with ${comments.length} comments.`);
  } catch (err) {
    console.log("⚠️ Review failed, falling back to issue comment");

    // 🔁 fallback (very important in production)
    await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: pull_number,
      body: buildFallbackBody(findings),
    });
  }
}

function formatComment(f: Finding): string {
  const icon =
    f.severity === "error"
      ? "❌"
      : f.severity === "info"
      ? "ℹ️"
      : "⚠️";

  return `${icon} **${f.rule}**: ${f.message}`;
}

function buildSummary(total: number): string {
  return [
    "🚀 **GHReview (Semgrep Analysis)**",
    "",
    `Found **${total} potential issues** in changed code.`,
    "",
    "_Only issues in modified lines are shown._",
  ].join("\n");
}

function buildFallbackBody(findings: Finding[]): string {
  const preview = findings.slice(0, 20);

  const lines = preview.map(
    (f) => `- \`${f.file}:${f.line}\` → **${f.rule}**: ${f.message}`,
  );

  return [
    "🚀 **GHReview (Semgrep Analysis)**",
    "",
    `Found **${findings.length} issues**.`,
    "",
    ...lines,
    "",
    findings.length > preview.length
      ? `_...and ${findings.length - preview.length} more_`
      : "",
  ].join("\n");
}