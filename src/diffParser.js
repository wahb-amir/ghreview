// src/diffParser.js
function parseHunks(patch) {
  const lines = patch.split("\n");
  const hunks = [];

  let currentHunk = null;

  for (const line of lines) {
    if (line.startsWith("@@")) {
      // Example: @@ -42,6 +42,10 @@
      const match = line.match(/\+(\d+),?(\d+)?/);

      if (match) {
        currentHunk = {
          start: parseInt(match[1]),
          end: parseInt(match[1]) + parseInt(match[2] || "1"),
          content: "",
        };
        hunks.push(currentHunk);
      }
    } else if (currentHunk) {
      if (line.startsWith("+")) {
        currentHunk.content += line + "\n";
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
    if (!file.patch) continue; // skip binary files
    const language = getLanguage(file.filename);
    if (!language) continue;

    const hunks = parseHunks(file.patch);

    changes.push({
      file: file.filename,
      language: getLanguage(file.filename),
      hunks,
    });
  }

  return changes;
}
