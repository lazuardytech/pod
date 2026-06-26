#!/usr/bin/env node
// Second pass: fix remaining TS1064, TS7053, and TS7018 errors

import { execSync } from "child_process";
import fs from "fs";

const EXCLUDE = ["open-sse/", "src/app/api/", "node_modules/", "cloud/", "tests/", ".next/"];

// Parse errors
let output;
try {
  output = execSync("bun x tsc --noEmit --noImplicitAny 2>&1", { encoding: "utf-8", maxBuffer: 100 * 1024 * 1024 });
} catch (e) {
  output = e.output ? e.output.filter(Boolean).join("") : e.stdout || "";
}

const errorsByFile = {};
for (const line of output.split("\n")) {
  const m = line.match(/^(.+)\((\d+),(\d+)\): error TS(\d+): (.+)$/);
  if (!m) continue;
  const file = m[1].trim();
  if (EXCLUDE.some((p) => file.includes(p))) continue;
  if (!errorsByFile[file]) errorsByFile[file] = [];
  errorsByFile[file].push({
    code: parseInt(m[4]),
    lineNum: parseInt(m[2]),
    col: parseInt(m[3]),
  });
}

console.log(`Errors to fix: ${Object.values(errorsByFile).flat().length}`);

import { Project, SyntaxKind } from "ts-morph";
const project = new Project({ tsConfigFilePath: "tsconfig.json", skipAddingFilesFromTsConfig: true });

for (const f of Object.keys(errorsByFile)) {
  try {
    project.addSourceFileAtPath(f);
  } catch {
    console.error(`Skip ${f}`);
  }
}

console.log(`Loaded ${project.getSourceFiles().length} files`);

let totalFixes = 0;
const codesNeeded = new Set(
  Object.values(errorsByFile)
    .flat()
    .map((e) => e.code),
);

// Get set of error codes per file
const fileCodeSets = {};
for (const [f, errs] of Object.entries(errorsByFile)) {
  fileCodeSets[f] = new Set(errs.map((e) => e.code));
}

for (const sourceFile of project.getSourceFiles()) {
  const filePath = sourceFile.getFilePath();
  const shortPath = filePath.replace(process.cwd() + "/", "");
  const codes = fileCodeSets[shortPath] || fileCodeSets[filePath];
  if (!codes) continue;

  let fileFixes = 0;

  // TS1064: async function with ': any' return type needs 'Promise<any>'
  if (codes.has(1064)) {
    for (const fn of sourceFile.getDescendantsOfKind(SyntaxKind.ArrowFunction)) {
      rtyFix(fn);
    }
    for (const fn of sourceFile.getDescendantsOfKind(SyntaxKind.FunctionExpression)) {
      rtyFix(fn);
    }
    for (const fn of sourceFile.getDescendantsOfKind(SyntaxKind.FunctionDeclaration)) {
      rtyFix(fn);
    }
  }

  function rtyFix(fn) {
    const rty = fn.getReturnTypeNode();
    if (!rty) return;
    const text = rty.getText();
    if (text === "any") {
      try {
        fn.setReturnType("Promise<any>");
        fileFixes++;
        totalFixes++;
      } catch {}
    }
  }

  // TS7018: object literal -> add Record<string, any>
  if (codes.has(7018)) {
    for (const vd of sourceFile.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
      try {
        if (vd.getTypeNode()) continue;
        if (vd.getInitializerIfKind(SyntaxKind.ObjectLiteralExpression)) {
          vd.setType("Record<string, any>");
          fileFixes++;
          totalFixes++;
        }
      } catch {}
    }
  }

  // TS7053: index access on objects
  // Fix by adding Record<string, any> to the object variable declarations
  if (codes.has(7053)) {
    for (const vd of sourceFile.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
      try {
        if (vd.getTypeNode()) continue;
        const init = vd.getInitializerIfKind(SyntaxKind.ObjectLiteralExpression);
        if (init) {
          vd.setType("Record<string, any>");
          fileFixes++;
          totalFixes++;
        }
      } catch {}
    }
  }

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
}
