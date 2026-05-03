import { spawnSync } from "child_process";

type SemgrepResult = {
  path: string;
  start: { line: number };
  check_id: string;
  extra?: {
    message?: string;
    severity?: string;
  };
};

type SemgrepJson = {
  results?: SemgrepResult[];
  errors?: unknown[];
};

export async function analyzeFile({
  repoPath,
  changedFiles,
}: {
  repoPath: string;
  changedFiles: string[];
}) {
  try {
    if (changedFiles.length === 0) {
      return [];
    }

    const semgrepArgs = [
      "--config=rules/semgrep.yml",
      "--json",
      "--quiet",
      ...changedFiles,
    ];

    const result = spawnSync("semgrep", semgrepArgs, {
      cwd: repoPath,
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
    });

    if (result.error) {
      throw result.error;
    }

    const stdout = result.stdout?.trim();
    if (!stdout) {
      return [];
    }

    const parsed = JSON.parse(stdout) as SemgrepJson;

    return (parsed.results ?? []).map((r) => ({
      file: r.path,
      line: r.start.line,
      rule: r.check_id,
      severity: normalizeSeverity(r.extra?.severity),
      message: r.extra?.message ?? "Semgrep finding",
    }));
  } catch (err) {
    console.log(
      "Semgrep failed:",
      err instanceof Error ? err.message : String(err),
    );
    return [];
  }
}

function normalizeSeverity(
  severity?: string,
): "warning" | "error" | "info" {
  switch (severity?.toLowerCase()) {
    case "error":
      return "error";
    case "info":
      return "info";
    case "warning":
    default:
      return "warning";
  }
}