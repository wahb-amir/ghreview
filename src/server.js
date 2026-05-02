// src/server.js
import express from "express";
import { Webhooks } from "@octokit/webhooks";
import { analyzeFile } from "./analysis.js";
import { parseDiff } from "./diffParser.js";
import { getOctokit, postReview } from "./github.js"; // Import the new helper
import dotenv from "dotenv";
dotenv.config();

const app = express();
app.use(express.json());

const webhooks = new Webhooks({
  secret: process.env.GITHUB_WEBHOOK_SECRET,
});

app.post("/webhook", async (req, res) => {
  const event = req.headers["x-github-event"];
  const signature = req.headers["x-hub-signature-256"];

  try {
    // Verify the signature first.
    await webhooks.verify(JSON.stringify(req.body), signature);

    // Respond immediately to GitHub.
    res.sendStatus(200);

    // Process the event asynchronously after responding.
    setImmediate(() => {
      void webhooks
        .receive({
          id: req.headers["x-github-delivery"],
          name: event,
          payload: req.body, 
          signature,
        })
        .catch((err) => {
          console.error("❌ Webhook processing error:", err.message);
        });
    });
  } catch (err) {
    console.error("❌ Webhook error:", err.message);
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

        const content = Buffer.from(fileRes.data.content, "base64").toString("utf8");

        const fileFindings = await analyzeFile({
          filename: change.file,
          content,
          hunks: change.hunks,
        });

        findings.push(...fileFindings);
      } catch (err) {
        console.log(`❌ Analyze error in ${change.file}:`, err.message);
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