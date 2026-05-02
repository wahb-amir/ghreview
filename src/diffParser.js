// src/diffParser.js
function parseHunks(patch) {
  const lines = patch.split("\n");
  const hunks = [];

  let currentHunk = null;
  let currentLineNumber = 0;

  for (const line of lines) {
    if (line.startsWith("@@")) {
      const match = line.match(/\+(\d+),?(\d+)?/);

      if (match) {
        const start = parseInt(match[1]);
        const length = parseInt(match[2] || "1");

        currentLineNumber = start;

        currentHunk = {
          start,
          end: start + length - 1,
          lines: [], // 👈 changed
        };

        hunks.push(currentHunk);
      }
    } else if (currentHunk) {
      if (line.startsWith("+")) {
        currentHunk.lines.push({
          lineNumber: currentLineNumber,
          content: line.slice(1), // remove "+"
        });
        currentLineNumber++;
      } else if (!line.startsWith("-")) {
        // context line (not removed)
        currentLineNumber++;
      }
    }
  }

  return hunks;
}

function getLanguage(filename) {
  if (filename.endsWith(".js")) return "javascript";
  if (filename.endsWith(".ts")) return "typescript";
  if (filename.endsWith(".py")) return "python";
  return null;
}


export function parseDiff(files) {
  const changes = [];

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