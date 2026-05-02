// src/github.js
import { App } from "@octokit/app";
import { Octokit } from "@octokit/rest";
import fs from "fs";
import process from "process";
import dotenv from "dotenv";
import path from "path";

// Get the directory name of the current module
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

if (!process.env.GITHUB_APP_ID || !process.env.GITHUB_WEBHOOK_SECRET) {
  console.error("❌ Missing GITHUB_APP_ID or GITHUB_WEBHOOK_SECRET in .env");
  process.exit(1);
}

const app = new App({
  appId: process.env.GITHUB_APP_ID,
  privateKey: fs.readFileSync("./key/key.pem", "utf8"),
  Octokit: Octokit,
});

export async function getOctokit(installationId: number): Promise<Octokit> {
  return app.getInstallationOctokit(installationId);
}

export async function postReview(
  octokit: Octokit,
  {
    owner,
    repo,
    pull_number,
    findings,
  }: { owner: string; repo: string; pull_number: number; findings: any[] },
) {
  if (findings.length === 0) return;

  const comments = findings.map(
    (f: { file: any; line: any; rule: any; message: any }) => ({
      path: f.file,
      line: f.line,
      body: `⚠️ **${f.rule}**: ${f.message}`,
    }),
  );

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
    if (err instanceof Error) {
      console.log(err.message);
    } else {
      console.log("Unknown error:", err);
    }
  }
}
