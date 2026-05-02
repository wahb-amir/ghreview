import express from "express";
import { Webhooks } from "@octokit/webhooks";
import { getOctokit, postReview } from "./github.js";
import { analyzeFile } from "./analysis.js";
import { parseDiff } from "./diffParser.js";
import path from "path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

const app = express();
app.use(express.json({
  verify: (req, _res, buf) => {
    (req as any).rawBody = buf.toString();
  },
}));

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

type AllowedEvent = typeof allowedEvents[number];

function isWebhookEventName(name: string): name is AllowedEvent {
  return allowedEvents.includes(name as AllowedEvent);
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

  void webhooks
    .receive({
      id: deliveryId,
      name: event, // ✅ now properly typed
      payload: req.body,
    })
    .catch((err) => {
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
  try {
    const { repository, pull_request, installation } = payload;

    if (!installation) {
      console.log("⚠️ No installation ID found");
      return;
    }

    const owner = repository.owner.login;
    const repo = repository.name;
    const prNumber = pull_request.number;

    console.log(`📦 PR opened: ${owner}/${repo} #${prNumber}`);

    const octokit = await getOctokit(installation.id);

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

    console.log("🧾 Parsed Changes:");
    console.log(JSON.stringify(changes, null, 2));

    const findings = [];

    for (const change of changes) {
      try {
        console.log("➡️ Analyzing:", change.file);

        const fileRes = await octokit.rest.repos.getContent({
          owner,
          repo,
          path: change.file,
        });

        if (Array.isArray(fileRes.data)) {
          console.log("⚠️ Skipping directory:", change.file);
          continue;
        }

        if (fileRes.data.type !== "file") {
          console.log("⚠️ Not a file:", change.file);
          continue;
        }

        if (!fileRes.data.content) {
          console.log("⚠️ No content found:", change.file);
          continue;
        }

        const content = Buffer.from(fileRes.data.content, "base64").toString(
          "utf8",
        );

        const fileFindings = await analyzeFile({
          filename: change.file,
          content,
          hunks: change.hunks,
        });

        findings.push(...fileFindings);
      } catch (err) {
        if (err instanceof Error) {
          console.log(err.message);
        } else {
          console.log("Unknown error:", err);
        }
      }
    }

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
  } catch (err) {
    console.error("❌ PR handler error:", err);
  }
});

app.listen(3000, () => {
  console.log("🚀 Server running on port 3000");
});
