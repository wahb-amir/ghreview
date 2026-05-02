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