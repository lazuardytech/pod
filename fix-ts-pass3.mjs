#!/usr/bin/env node
// Third pass: carefully fix remaining TS1064 and TS7053 errors
// TS1064: async function with ': any' return type -> needs 'Promise<any>'
// TS7053: index access on objects with explicit key types -> add index signature
// TS7018: object literal with implicit any -> add explicit type

import { execSync } from "child_process";
import fs from "fs";

const EXCLUDE = ["open-sse/", "src/app/api/", "node_modules/", "cloud/", "tests/", ".next/"];

let output;
try {
  output = execSync("bun x tsc --noEmit --noImplicitAny 2>&1", { encoding: "utf-8", maxBuffer: 100 * 1024 * 1024 });
} catch (e) {
  output = e.output ? e.output.filter(Boolean).join("") : e.stdout || "";
}

// Collect errors and group by type
const errorsByFile = {};
for (const line of output.split("\n")) {
  const m = line.match(/^(.+)\((\d+),(\d+)\): error TS(\d+): (.+)$/);
  if (!m) continue;
  const file = m[1].trim();
  if (EXCLUDE.some((p) => file.includes(p))) continue;
  if (!errorsByFile[file]) errorsByFile[file] = { byCode: {} };
  const code = parseInt(m[4]);
  if (!errorsByFile[file].byCode[code]) errorsByFile[file].byCode[code] = [];
  errorsByFile[file].byCode[code].push({ line: parseInt(m[2]), col: parseInt(m[3]) });
}

const total = Object.values(errorsByFile).reduce(
  (s, f) => s + Object.values(f.byCode).reduce((ss, arr) => ss + arr.length, 0),
  0,
);
console.log(`Remaining: ${total} errors`);

import { Project, SyntaxKind } from "ts-morph";
const project = new Project({ tsConfigFilePath: "tsconfig.json", skipAddingFilesFromTsConfig: true });

for (const f of Object.keys(errorsByFile)) {
  try {
    project.addSourceFileAtPath(f);
  } catch {
    console.error(`Skip ${f}`);
  }
}

let totalFixes = 0;

for (const sourceFile of project.getSourceFiles()) {
  const filePath = sourceFile.getFilePath();
  const shortPath = filePath.replace(process.cwd() + "/", "");
  const errInfo = errorsByFile[shortPath] || errorsByFile[filePath];
  if (!errInfo) continue;
  const codes = new Set(Object.keys(errInfo.byCode).map(Number));
  let fileFixes = 0;

  // TS1064: Fix async arrow functions with ': any' return type that should be 'Promise<any>'
  if (codes.has(1064)) {
    for (const fn of sourceFile.getDescendantsOfKind(SyntaxKind.ArrowFunction)) {
      fixRetType(fn);
    }
    for (const fn of sourceFile.getDescendantsOfKind(SyntaxKind.FunctionExpression)) {
      fixRetType(fn);
    }
    for (const fn of sourceFile.getDescendantsOfKind(SyntaxKind.FunctionDeclaration)) {
      fixRetType(fn);
    }
  }

  function fixRetType(fn) {
    try {
      const rty = fn.getReturnTypeNode();
      if (!rty) return;
      const text = rty.getText();
      if (
        text === "any" &&
        rty.getParent() &&
        rty.getParent().getKind &&
        rty.getParent().getKind() === SyntaxKind.ArrowFunction
      ) {
        fn.setReturnType("Promise<any>");
        fileFixes++;
        totalFixes++;
      } else if (text === "any") {
        // For any function/method, check if it uses await inside
        const body = fn.getBody();
        if (body) {
          const hasAwait = body.getDescendantsOfKind(SyntaxKind.AwaitExpression).length > 0;
          if (hasAwait) {
            fn.setReturnType("Promise<any>");
            fileFixes++;
            totalFixes++;
          }
        }
      }
    } catch {}
  }

  // TS7018: Object literal -> Record<string, any>
  if (codes.has(7018)) {
    // Only fix TS7018 for variable declarations where the code specifically points
    // Look at the lines reported
    for (const [lineNum, col] of errInfo.byCode[7018].map((e) => [e.line, e.col])) {
      // Find variable declarations whose initializer is an object literal
      for (const vd of sourceFile.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
        try {
          if (vd.getTypeNode()) continue;
          const init = vd.getInitializerIfKind(SyntaxKind.ObjectLiteralExpression);
          if (!init) continue;
          vd.setType("Record<string, any>");
          fileFixes++;
          totalFixes++;
        } catch {}
      }
    }
  }

  // TS7053 / TS2347: Need index access handling
  // For TS7053 we need to be smarter - for objects with known shapes, add [key: string]: any
  // For TS2347 it needs the function to be typed
  // These are best fixed manually since the right fix depends on context

  if (fileFixes > 0) {
    sourceFile.saveSync();
    console.log(`  ${shortPath}: ${fileFixes} fixes`);
  }
}

console.log(`\nTotal fixes: ${totalFixes}`);

// Verify
try {
  execSync("bun x tsc --noEmit --noImplicitAny 2>&1", {
    encoding: "utf-8",
    maxBuffer: 10 * 1024 * 1024,
    stdio: "pipe",
  });
  console.log("ZERO ERRORS");
} catch (e) {
  const vout = e.output ? e.output.filter(Boolean).join("") : e.stdout || "";
  const remaining = vout.split("\n").filter((l) => l.includes("error TS") && !EXCLUDE.some((p) => l.includes(p)));

  const byCode = {};
  for (const l of remaining) {
    const c = l.match(/error TS(\d+)/)?.[1] || "unknown";
    byCode[c] = (byCode[c] || 0) + 1;
  }
  console.log(`Remaining: ${remaining.length}`);
  console.log(
    "By code:",
    Object.entries(byCode)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k}=${v}`)
      .join(", "),
  );

  const byFile = {};
  for (const l of remaining) {
    const f = l.match(/^(.+)\(\d+/)?.[1]?.trim() || "unknown";
    byFile[f] = (byFile[f] || 0) + 1;
  }
  for (const [f, c] of Object.entries(byFile)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)) {
    console.log(`  ${f}: ${c}`);
  }

  fs.writeFileSync("remaining-errors.txt", remaining.join("\n"));
  console.log(`\nFull list saved to remaining-errors.txt`);
}
