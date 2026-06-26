#!/usr/bin/env node
// Fix noImplicitAny TS errors using ts-morph

import { execSync } from "child_process";
import fs from "fs";

const rootDir = process.cwd();

let output;
try {
  output = execSync("bun x tsc --noEmit --noImplicitAny 2>&1", { encoding: "utf-8", maxBuffer: 100 * 1024 * 1024 });
} catch (e) {
  output = e.output ? e.output.filter(Boolean).join("") : e.stdout || "";
}

const lines = output.split("\n");
const fileCodes = {};
const EXCLUDE = ["open-sse/", "src/app/api/", "node_modules/", "cloud/", "tests/", ".next/"];

for (const line of lines) {
  const m = line.match(/^(.+)\((\d+),(\d+)\): error TS(\d+): (.+)$/);
  if (!m) continue;
  const file = m[1].trim();
  if (EXCLUDE.some((p) => file.includes(p))) continue;
  if (!fileCodes[file]) fileCodes[file] = new Set();
  fileCodes[file].add(parseInt(m[4]));
}

const FILES = Object.keys(fileCodes);
console.log(`Files: ${FILES.length}`);

const { Project, SyntaxKind } = await import("ts-morph");
const project = new Project({ tsConfigFilePath: "tsconfig.json", skipAddingFilesFromTsConfig: true });

for (const f of FILES) {
  try {
    project.addSourceFileAtPath(f);
  } catch {}
}
console.log(`Loaded: ${project.getSourceFiles().length}`);

function hasAwait(fn) {
  try {
    const body = fn.getBody();
    if (!body) return false;
    const descendants = body.getDescendantsOfKind ? body.getDescendantsOfKind(SyntaxKind.AwaitExpression) : [];
    return descendants.length > 0;
  } catch {
    return false;
  }
}

let totalFixes = 0;

for (const sourceFile of project.getSourceFiles()) {
  const filePath = sourceFile.getFilePath();
  const shortPath = filePath.replace(rootDir + "/", "");
  const codes = fileCodes[shortPath] || fileCodes[filePath];
  if (!codes) continue;

  let fileFixes = 0;
  function safe(fn) {
    try {
      const r = fn();
      if (r !== undefined) return r;
    } catch {}
    return false;
  }

  // TS7034: new Set/Map
  if (codes.has(7034)) {
    for (const ne of sourceFile.getDescendantsOfKind(SyntaxKind.NewExpression)) {
      safe(() => {
        const name = ne.getExpression().getText();
        if (name === "Set" && ne.getTypeArguments().length === 0) {
          ne.addTypeArgument("any");
          fileFixes++;
          totalFixes++;
        } else if (name === "Map" && ne.getTypeArguments().length === 0) {
          ne.addTypeArgument("string");
          ne.addTypeArgument("any");
          fileFixes++;
          totalFixes++;
        }
      });
    }
  }

  // TS7006 + TS7031: Parameters
  if (codes.has(7006) || codes.has(7031)) {
    for (const fnKind of [
      SyntaxKind.ArrowFunction,
      SyntaxKind.FunctionExpression,
      SyntaxKind.FunctionDeclaration,
      SyntaxKind.MethodDeclaration,
      SyntaxKind.Constructor,
    ]) {
      for (const fnNode of sourceFile.getDescendantsOfKind(fnKind)) {
        for (const param of fnNode.getParameters()) {
          safe(() => {
            if (param.getTypeNode()) return;
            const pp = param.getParent();
            if (pp && pp.getKind() === SyntaxKind.CatchClause) return;
            // Skip if param is inside destructuring pattern (handled by TS7031)
            if (pp && (pp.getKind() === SyntaxKind.ObjectBindingPattern || pp.getKind() === SyntaxKind.ArrayBindingPattern)) return;
            param.setType("any");
            fileFixes++;
            totalFixes++;
          });
        }
      }
    }
  }

  // TS7018: Object literal
  if (codes.has(7018)) {
    for (const vd of sourceFile.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
      safe(() => {
        if (vd.getTypeNode()) return;
        if (vd.getInitializerIfKind(SyntaxKind.ObjectLiteralExpression)) {
          vd.setType("any");
          fileFixes++;
          totalFixes++;
        }
      });
    }
  }

  // TS7005: Variable
  if (codes.has(7005)) {
    for (const vs of sourceFile.getDescendantsOfKind(SyntaxKind.VariableStatement)) {
      for (const vd of vs.getDeclarations()) {
        safe(() => {
          if (vd.getTypeNode()) return;
          vd.setType("any");
          fileFixes++;
          totalFixes++;
        });
      }
    }
  }

  // TS7023/7011/7010: Return type. For async, use Promise<any>
  if (codes.has(7023) || codes.has(7011) || codes.has(7010)) {
    for (const k of [
      SyntaxKind.ArrowFunction,
      SyntaxKind.FunctionExpression,
      SyntaxKind.FunctionDeclaration,
      SyntaxKind.MethodDeclaration,
    ]) {
      for (const fn of sourceFile.getDescendantsOfKind(k)) {
        safe(() => {
          if (fn.getReturnTypeNode()) return;
          fn.setReturnType(hasAwait(fn) ? "Promise<any>" : "any");
          fileFixes++;
          totalFixes++;
        });
      }
    }
  }

  if (fileFixes > 0) {
    sourceFile.saveSync();
    console.log(`  ${shortPath}: ${fileFixes} fixes`);
  }
}

console.log(`Total: ${totalFixes}`);

// Verify
console.log("\nVerifying...");
try {
  execSync("bun x tsc --noEmit --noImplicitAny 2>&1", {
    encoding: "utf-8",
    maxBuffer: 10 * 1024 * 1024,
    stdio: "pipe",
  });
  console.log("ZERO ERRORS");
} catch (e) {
  const vout = e.output ? e.output.filter(Boolean).join("") : e.stdout || "";
  const remaining = vout.split("\n").filter((l) => {
    if (!l.includes("error TS")) return false;
    return !EXCLUDE.some((p) => l.includes(p));
  });

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
    .slice(0, 20)) {
    console.log(`  ${f}: ${c}`);
  }

  // For remaining TS1064 errors, apply targeted per-line fixes on the saved files
  if (byCode["1064"]) {
    console.log(`\nFixing ${byCode["1064"]} TS1064 errors via string replacement...`);
    const errors1064 = remaining.filter((l) => l.includes("error TS1064"));
    for (const errLine of errors1064) {
      const em = errLine.match(/^(.+)\((\d+)/);
      if (!em) continue;
      const file = em[1].trim();
      const lineNum = parseInt(em[2]);
      try {
        const content = fs.readFileSync(file, "utf-8");
        const fLines = content.split("\n");
        const idx = lineNum - 1;
        if (idx < 0 || idx >= fLines.length) continue;
        const line = fLines[idx];
        // Change `): any {` or `): any =>` to `): Promise<any> {`
        const fixed = line
          .replace(/\)\s*:\s*\bany\b\s*(?=\{)/, "): Promise<any> {")
          .replace(/\)\s*:\s*\bany\b\s*(?=\s*=>)/, "): Promise<any> =>");
        if (fixed !== line) {
          fLines[idx] = fixed;
          fs.writeFileSync(file, fLines.join("\n"));
          console.log(`  ${file}:${lineNum} fixed`);
        }
      } catch {}
    }
  }

  if (byCode["7053"]) {
    console.log(`\nFixing ${byCode["7053"]} TS7053 errors via targeted replacements...`);
    const errors7053 = remaining.filter((l) => l.includes("error TS7053"));
    for (const errLine of errors7053) {
      const em = errLine.match(/^(.+)\((\d+),(\d+)/);
      if (!em) continue;
      const file = em[1].trim();
      const lineNum = parseInt(em[2]);
      const colNum = parseInt(em[3]);
      try {
        const content = fs.readFileSync(file, "utf-8");
        const fLines = content.split("\n");
        const idx = lineNum - 1;
        if (idx < 0 || idx >= fLines.length) continue;
        const line = fLines[idx];
        // Check if there's a `= {}` pattern on this line we can cast
        if (line.includes("= {}")) {
          // Add as Record<string, any> at the declaration
          const fixed = line.replace(/\{\}\s*$/, "{} as Record<string, any>");
          if (fixed !== line) {
            fLines[idx] = fixed;
            fs.writeFileSync(file, fLines.join("\n"));
            console.log(`  ${file}:${lineNum} fixed (Record cast)`);
          }
        }
      } catch {}
    }
  }

  // Verify again
  console.log("\nFinal verify...");
  try {
    execSync("bun x tsc --noEmit --noImplicitAny 2>&1", {
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
      stdio: "pipe",
    });
    console.log("ZERO ERRORS");
  } catch (e2) {
    const vout2 = e2.output ? e2.output.filter(Boolean).join("") : e2.stdout || "";
    const rem2 = vout2.split("\n").filter((l) => l.includes("error TS") && !EXCLUDE.some((p) => l.includes(p)));
    console.log(`Remaining: ${rem2.length}`);
    fs.writeFileSync("remaining-errors.txt", rem2.join("\n"));
  }
}
