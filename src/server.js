// src/server.js
import express from "express";
import { Webhooks } from "@octokit/webhooks";
import { getOctokit } from "./github.js";
import { analyzeFile } from "./analysis.js";
import { parseDiff } from "./diffParser.js";
import dotenv from "dotenv";

dotenv.config();
const app = express();
app.use(express.json());

// 🔐 GitHub webhook verifier
const webhooks = new Webhooks({
  secret: process.env.GITHUB_WEBHOOK_SECRET,
});

// 📡 Main webhook route
app.post("/webhook", async (req, res) => {
  try {
    const event = req.headers["x-github-event"];

    await webhooks.verifyAndReceive({
      id: req.headers["x-github-delivery"],
      name: event,
      signature: req.headers["x-hub-signature-256"],
      payload: JSON.stringify(req.body),
    });

    // ⚠️ Always respond fast
    res.sendStatus(200);
  } catch (err) {
    console.error("❌ Webhook error:", err.message);
    return res.sendStatus(401);
  }
});

// 🎯 Handle PR opened event
webhooks.on("pull_request.opened", async ({ payload }) => {
  try {
    const { repository, pull_request, installation } = payload;

    const owner = repository.owner.login;
    const repo = repository.name;
    const prNumber = pull_request.number;

    console.log(`📦 PR opened: ${owner}/${repo} #${prNumber}`);

    const octokit = await getOctokit(installation.id);

    // 🔍 Fetch changed files
    const filesRes = await octokit.rest.pulls.listFiles({
      owner,
      repo,
      pull_number: prNumber,
    });

    let files = filesRes.data;

    // 🚧 Limit large PRs (IMPORTANT)
    if (files.length > 15) {
      files = files.sort((a, b) => b.changes - a.changes).slice(0, 5);
      console.log("⚠️ Large PR detected, limiting to top 5 files");
    }

    // 🧠 Parse diff into structured format
    const changes = parseDiff(files);

    console.log("🧾 Parsed Changes:");
    console.log(JSON.stringify(changes, null, 2));

    // 🔍 NEW: Run AST analysis
    const findings = [];

    for (const change of changes) {
      try {
        const fileRes = await octokit.rest.repos.getContent({
          owner,
          repo,
          path: change.file,
        });

        // skip if not a file
        if (fileRes.data.type !== "file") continue;

        const content = Buffer.from(fileRes.data.content, "base64").toString();

        const fileFindings = await analyzeFile({
          filename: change.file,
          content,
          hunks: change.hunks,
        });

        findings.push(...fileFindings);
      } catch (err) {
        console.log(`⚠️ Failed to analyze ${change.file}`);
      }
    }

    // 🔍 Final output
    console.log("🔍 Findings:");
    console.log(JSON.stringify(findings, null, 2));

    console.log("🧾 Parsed Changes:");
    console.log(JSON.stringify(changes, null, 2));
  } catch (err) {
    console.error("❌ PR handler error:", err);
  }
});

// 🚀 Start server
app.listen(3000, () => {
  console.log("🚀 Server running on port 3000");
});
