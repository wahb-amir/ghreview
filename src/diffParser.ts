// src/diffParser.ts

type Language = "javascript" | "typescript" | "python";

interface DiffLine {
  lineNumber: number;
  content: string;
}

interface Hunk {
  start: number;
  end: number;
  lines: DiffLine[];
}

interface DiffFile {
  filename: string;
  patch?: string | null;
}

interface ParsedChange {
  file: string;
  language: Language;
  hunks: Hunk[];
}

function parseHunks(patch: string): Hunk[] {
  const lines = patch.split("\n");
  const hunks: Hunk[] = [];

  let currentHunk: Hunk | null = null;
  let currentLineNumber = 0;

  for (const line of lines) {
    if (line.startsWith("@@")) {
      const match = line.match(/\+(\d+),?(\d+)?/);

      if (match) {
        const start = Number.parseInt(match[1], 10);
        const length = Number.parseInt(match[2] ?? "1", 10);

        currentLineNumber = start;

        currentHunk = {
          start,
          end: start + length - 1,
          lines: [],
        };

        hunks.push(currentHunk);
      }
    } else if (currentHunk) {
      if (line.startsWith("+")) {
        currentHunk.lines.push({
          lineNumber: currentLineNumber,
          content: line.slice(1),
        });
        currentLineNumber++;
      } else if (!line.startsWith("-")) {
        currentLineNumber++;
      }
    }
  }

  return hunks;
}

function getLanguage(filename: string): Language | null {
  if (filename.endsWith(".js")) return "javascript";
  if (filename.endsWith(".ts")) return "typescript";
  if (filename.endsWith(".py")) return "python";
  return null;
}

export function parseDiff(files: DiffFile[]): ParsedChange[] {
  const changes: ParsedChange[] = [];

  for (const file of files) {
    if (!file.patch) continue;

    const language = getLanguage(file.filename);
    if (!language) continue;

    const hunks = parseHunks(file.patch);

    changes.push({
      file: file.filename,
      language,
      hunks,
    });
  }

  return changes;
}