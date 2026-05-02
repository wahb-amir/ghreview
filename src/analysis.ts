import { parse } from "@babel/parser";
import * as _traverse from "@babel/traverse";
import type { NodePath } from "@babel/traverse";
import type { File, CallExpression } from "@babel/types";

const traverse = (_traverse as any).default || _traverse;

export interface Hunk {
  start: number;
  end: number;
}

export interface Finding {
  file: string;
  line: number;
  rule: string;
  severity: "warning" | "error" | "info";
  message: string;
}

export interface AnalyzeFileInput {
  filename: string;
  content: string;
  hunks: Hunk[];
}

export async function analyzeFile({
  filename,
  content,
  hunks,
}: AnalyzeFileInput): Promise<Finding[]> {
  const findings: Finding[] = [];

  let ast: File;

  try {
    ast = parse(content, {
      sourceType: "module",
      plugins: ["jsx", "typescript"],
    }) as File;
  } catch {
    console.log(`⚠️ Failed to parse ${filename}`);
    return findings;
  }

  traverse(ast, {
    CallExpression(path: NodePath<CallExpression>) {
      const callee = path.node.callee;

      if (
        callee.type === "MemberExpression" &&
        !callee.computed &&
        callee.object.type === "Identifier" &&
        callee.object.name === "console" &&
        callee.property.type === "Identifier" &&
        callee.property.name === "log"
      ) {
        const loc = path.node.loc;
        if (!loc) return;

        const line = loc.start.line;

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

function isInChangedRange(line: number, hunks: Hunk[]): boolean {
  return hunks.some((h) => line >= h.start && line <= h.end);
}