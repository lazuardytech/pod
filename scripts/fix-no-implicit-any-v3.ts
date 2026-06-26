/**
 * fix-no-implicit-any-v3.ts
 * Corrected: deduplicates line-level fixes to prevent double-application.
 * Usage: bun run scripts/fix-no-implicit-any-v3.ts
 */

import { execSync } from "child_process";
import { readFileSync, writeFileSync } from "fs";

interface TSError {
  file: string;
  line: number;
  col: number;
  code: string;
  message: string;
}

function parseErrors(): TSError[] {
  const stdout = execSync(
    `bun x tsc --noEmit 2>&1 | grep "error TS" | grep -v "open-sse/"`,
    { cwd: "/Users/ezra/projects/lt/pod", encoding: "utf-8", maxBuffer: 100 * 1024 * 1024 }
  );
  const lines = stdout.trim().split("\n").filter(Boolean);
  const errors: TSError[] = [];
  for (const line of lines) {
    const m = line.match(/^(.+?)\((\d+),(\d+)\):\s+error\s+(TS\d+):\s+(.+)$/);
    if (!m) continue;
    errors.push({ file: m[1], line: parseInt(m[2]), col: parseInt(m[3]), code: m[4], message: m[5] });
  }
  return errors;
}

/**
 * Apply line-level fixes. Each line is only modified once.
 */
function fixFile(filePath: string, errors: TSError[]): number {
  let source = readFileSync(filePath, "utf-8");
  const lines = source.split("\n");
  
  // Track which lines we've already modified
  const modifiedLines = new Set<number>();
  let fixed = 0;

  for (const error of errors) {
    const lineIdx = error.line - 1;
    if (lineIdx < 0 || lineIdx >= lines.length) continue;
    if (modifiedLines.has(lineIdx)) continue; // skip already-modified lines
    
    const original = lines[lineIdx];
    let line = original;

    if (error.code === "TS7006") {
      const pm = error.message.match(/Parameter '(\w+)' implicitly has an 'any' type/);
      if (!pm) continue;
      const pn = pm[1];
      if (line.match(new RegExp(`\\b${pn}\\s*:\\s*\\w`))) continue; // already typed

      // catch (e) -> catch (e: any)
      if (line.match(new RegExp(`catch\\s*\\(\\s*${pn}\\s*\\)`))) {
        line = line.replace(new RegExp(`(catch\\s*\\(\\s*)(${pn})(\\s*\\))`), "$1$2: any$3");
      }
      // .map/.filter/.forEach/.then/.catch callback args
      else if (line.match(new RegExp(`\\.(map|filter|forEach|then|catch|reduce|some|every|find|findIndex|flatMap|sort|toSorted)\\s*\\(\\s*${pn}\\s*(,|=>)`))) {
        line = line.replace(new RegExp(`(\\.(?:map|filter|forEach|then|catch|reduce|some|every|find|findIndex|flatMap|sort|toSorted)\\s*\\()(${pn})(\\s*(?:,|=>))`), "$1$2: any$3");
      }
      // General: param followed by , ) or =>
      else {
        let replaced = false;
        // Try ,) first
        const re1 = new RegExp(`\\b${pn}\\b(?=\\s*[,)])`);
        if (re1.test(line)) {
          line = line.replace(re1, `${pn}: any`);
          replaced = true;
        }
        // Try ) =>
        if (!replaced) {
          const re2 = new RegExp(`\\b${pn}\\b(?=\\s*\\)\\s*=>)`);
          if (re2.test(line)) {
            line = line.replace(re2, `${pn}: any`);
            replaced = true;
          }
        }
        if (!replaced) continue;
      }
    }
    else if (error.code === "TS7031") {
      // Binding element implicitly has 'any' type.
      // Pattern: ({ key })  or  ({ key1, key2 })
      // Only fix if there's no existing : after the closing brace
      const destructured = line.match(/\{\s*([^}]+)\s*\}/);
      if (!destructured) continue;
      
      // Only fix if this is followed by ) or => without a type annotation already
      if (!(/\}\s*\)/.test(line) || /\}\s*=>/.test(line))) continue;
      // Check if already typed (closing brace followed by :)
      if (/\}\s*:\s*\{/.test(line)) continue;
      
      const inner = destructured[1].trim();
      const keys = inner.split(",").map((k) => k.trim()).filter(Boolean);
      const typeLiteral = "{ " + keys.map((k) => `${k}: any`).join("; ") + " }";
      line = line.replace(destructured[0], `{ ${inner} }: ${typeLiteral}`);
    }
    else if (error.code === "TS7053") {
      // string index into typed object
      const bracketMatches = Array.from(line.matchAll(/(\w+)\[([^\]]+)\]/g));
      for (const bm of bracketMatches) {
        const objName = bm[1];
        const indexExpr = bm[2].trim();
        const fullMatch = bm[0];
        if (fullMatch.includes("as keyof typeof") || fullMatch.includes(" as ")) continue;
        const replacement = `${objName}[${indexExpr} as keyof typeof ${objName}]`;
        if (!line.includes(replacement)) {
          line = line.replace(fullMatch, replacement);
        }
      }
    }
    else if (error.code === "TS7018") {
      const m = line.match(/^( *)(const|let|var)\s+(\w+)\s*=\s*\{/);
      if (m) {
        const keyword = m[2];
        const varName = m[3];
        line = line.replace(`${keyword} ${varName} = {`, `${keyword} ${varName}: Record<string, any> = {`);
      }
    }
    else if (error.code === "TS7034") {
      if (line.includes("new Set()")) line = line.replace(/new Set\(\)/g, "new Set<any>()");
      if (line.includes("new Map()")) line = line.replace(/new Map\(\)/g, "new Map<any, any>()");
    }
    else if (error.code === "TS7005") {
      const vm = error.message.match(/Variable '(\w+)' implicitly has an 'any' type/);
      if (!vm) continue;
      const varName = vm[1];
      if (line.match(new RegExp(`\\b${varName}\\s*=\\s*setInterval|\\b${varName}\\s*=\\s*setTimeout`))) {
        line = line.replace(new RegExp(`(${varName})\\s*=`), "$1: ReturnType<typeof setInterval> =");
      } else if (line.match(new RegExp(`(let|var)\\s+${varName}[,;\\s]`))) {
        line = line.replace(new RegExp(`\\b${varName}\\b(?=[,;\\s])`), `${varName}: any`);
      }
    }
    else if (error.code === "TS7010") {
      const rm = error.message.match(/'(.+?)', which lacks return-type annotation/);
      if (!rm) continue;
      const funcName = rm[1];
      if (line.match(new RegExp(`function\\s+${funcName}\\s*\\([^)]*\\)\\s*\\{`))) {
        line = line.replace(new RegExp(`(function\\s+${funcName}\\s*\\([^)]*\\))`), "$1: any");
      }
    }
    else if (error.code === "TS7023") {
      const nm = error.message.match(/'(\w+)' implicitly has return type/);
      if (!nm) continue;
      const funcName = nm[1];
      if (line.match(new RegExp(`(const|let|var)\\s+${funcName}\\s*=\\s*\\(`))) {
        line = line.replace(new RegExp(`(${funcName}\\s*=)\\s*(\\([^)]*\\)\\s*=>)`), "$1 $2: any");
      }
    }
    else if (error.code === "TS2538") {
      // unknown cannot be used as index type
      // Object.entries(obj).map(([key, val]) => key is unknown
      // Fix: add as string
      // This is hard to fix mechanically, skip
      continue;
    }

    if (line !== original) {
      lines[lineIdx] = line;
      modifiedLines.add(lineIdx);
      fixed++;
    }
  }

  if (fixed > 0) {
    writeFileSync(filePath, lines.join("\n"), "utf-8");
  }
  return fixed;
}

// Main
console.log("Parsing errors...");
const allErrors = parseErrors();
console.log(`Total errors: ${allErrors.length}`);

const byFile = new Map<string, TSError[]>();
for (const e of allErrors) {
  if (!byFile.has(e.file)) byFile.set(e.file, []);
  byFile.get(e.file)!.push(e);
}

console.log(`Unique files: ${byFile.size}`);

let totalFixed = 0;
for (const [file, errors] of byFile) {
  const f = fixFile(file, errors);
  totalFixed += f;
  if (f > 0) console.log(`  ${file}: ${f} fixed`);
}

console.log(`\nDone. Fixed: ${totalFixed} errors.`);
