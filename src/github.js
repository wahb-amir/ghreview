// src/github.js
import { App } from "@octokit/app";
import { Octokit } from "@octokit/rest";
import fs from "fs";
import process from "process";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

// Get the directory name of the current module
const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: path.resolve(__dirname, ".env") });

const app = new App({
  appId: process.env.GITHUB_APP_ID,
  privateKey: fs.readFileSync("./key/key.pem", "utf8"),
  Octokit: Octokit, 
});

export async function getOctokit(installationId) {
  return await app.getInstallationOctokit(installationId);
}
export async function postReview(octokit, { owner, repo, pull_number, findings }) {
  if (findings.length === 0) return;

  const comments = findings.map((f) => ({
    path: f.file,
    line: f.line,
    body: `⚠️ **${f.rule}**: ${f.message}`,
  }));

  try {
    await octokit.rest.pulls.createReview({
      owner,
      repo,
      pull_number,
      event: "COMMENT", // Per Phase 0.5 guidelines
      body: "🚀 **GHReview Analysis**: I've scanned the changed files using AST-based deterministic rules.",
      comments,
    });
    console.log(`✅ Review posted with ${findings.length} comments.`);
  } catch (err) {
    console.error("❌ Failed to post review:", err.message);
  }
}