// src/analysis.js
import { parse } from "@babel/parser";
import _traverse from "@babel/traverse";

const traverse = _traverse.default || _traverse;

export async function analyzeFile({
  filename,
  content,
  hunks,
}) {
  const findings = [];

  let ast;

  try {
    ast = parse(content, {
      sourceType: "module",
      plugins: ["jsx", "typescript"],
    });
  } catch (err) {
    console.log(`⚠️ Failed to parse ${filename}`);
    return findings;
  }

  traverse(ast, {
    CallExpression(path) {
      const callee = path.node.callee;

      if (
        callee.type === "MemberExpression" &&
        callee.object.name === "console"
      ) {
        const line = path.node.loc.start.line;

        if (isInChangedRange(line, hunks)) {
          findings.push({
            file: filename,
            line,
            rule: "no-console-log",
            severity: "warning",
            message: "console.log found in changed code",
          });
        }
      }
    },
  });

  return findings;
}


// helper
function isInChangedRange(line, hunks) {
  return hunks.some(h => line >= h.start && line <= h.end);
}