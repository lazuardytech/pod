/**
 * fix-no-implicit-any-v4.ts
 * More comprehensive: handles inline callbacks, JSX handlers, multi-line.
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
  const stdout = execSync(`bun x tsc --noEmit 2>&1 | grep "error TS" | grep -v "open-sse/"`, {
    cwd: "/Users/ezra/projects/lt/pod",
    encoding: "utf-8",
    maxBuffer: 100 * 1024 * 1024,
  });
  const lines = stdout.trim().split("\n").filter(Boolean);
  const errors: TSError[] = [];
  for (const line of lines) {
    const m = line.match(/^(.+?)\((\d+),(\d+)\):\s+error\s+(TS\d+):\s+(.+)$/);
    if (!m) continue;
    errors.push({
      file: m[1],
      line: parseInt(m[2]),
      col: parseInt(m[3]),
      code: m[4],
      message: m[5],
    });
  }
  return errors;
}

function fixFile(filePath: string, errors: TSError[]): number {
  let source = readFileSync(filePath, "utf-8");
  let fixed = 0;

  // Track modifications by line so we don't double-fix
  const modifiedLines = new Set<number>();

  for (const error of errors) {
    const lineIdx = error.line - 1;

    // TS7006 - parameter has implicit 'any' type
    if (error.code === "TS7006") {
      const pm = error.message.match(/Parameter '(\w+)' implicitly has an 'any' type/);
      if (!pm) continue;
      const pn = pm[1];

      // Find the exact line in the current source
      const lines = source.split("\n");
      if (lineIdx < 0 || lineIdx >= lines.length) continue;
      if (modifiedLines.has(lineIdx)) continue;
      let line = lines[lineIdx];
      const originalLine = line;

      // Skip if already typed (has : after the param name in the right context)
      // Use the error column to locate the exact position
      const col = error.col;
      // col is 1-indexed character position of the error
      // Look at the character before col - if it's : then already fixed
      if (line.charAt(col - 2) === ":") continue;

      // Strategy: find the parameter name at the given column position
      const before = line.substring(0, col - 1);
      const after = line.substring(col - 1);

      // Check if the parameter at this position already has a type annotation
      if (after.match(/^\w+\s*:/)) continue;

      // Attempt intelligent fix based on context
      // Pattern 1: catch (e) -> catch (e: any)
      const catchRe = new RegExp(`catch\\s*\\(\\s*${pn}\\s*\\)`);
      if (catchRe.test(line)) {
        line = line.replace(new RegExp(`(catch\\s*\\(\\s*)(${pn})(\\s*\\))`), "$1$2: any$3");
      }
      // Pattern 2: In a callback chain: .map/.filter/...
      else {
        // Try general replacement: add : any after param, being careful about position
        // Use position-specific replacement
        const paramAtCol = new RegExp(`.{${col - 1}}${pn}\\b`);
        const colCheck = paramAtCol.exec(line);
        if (colCheck) {
          // Insert ": any" right after the param name at col position
          const insertPos = colCheck.index + pn.length;
          line = line.substring(0, insertPos) + ": any" + line.substring(insertPos);
        }
      }

      if (line !== originalLine) {
        lines[lineIdx] = line;
        modifiedLines.add(lineIdx);
        fixed++;
        source = lines.join("\n");
      }
    }

    // TS7031 - binding element implicit any
    else if (error.code === "TS7031") {
      const lines = source.split("\n");
      if (lineIdx < 0 || lineIdx >= lines.length) continue;
      if (modifiedLines.has(lineIdx)) continue;
      let line = lines[lineIdx];
      const originalLine = line;

      // Find destructured object pattern
      const destructured = line.match(/\{\s*([^}]+)\s*\}(?!\s*:)/);
      if (destructured) {
        // Check if already has type annotation (}: { )
        if (/\}\s*:\s*\{/.test(line)) continue;

        const inner = destructured[1].trim();
        // Handle default values: key = default
        const keys = inner
          .split(",")
          .map((k) => {
            const eqIdx = k.indexOf("=");
            return eqIdx >= 0 ? k.substring(0, eqIdx).trim() : k.trim();
          })
          .filter(Boolean);

        // Only add type if followed by ) or =>
        if (/\}\s*\)/.test(line) || /\}\s*=>/.test(line)) {
          const typeLiteral = "{ " + keys.map((k) => `${k}: any`).join("; ") + " }";
          line = line.replace(destructured[0], `${destructured[0]}: ${typeLiteral}`);
        }
      }

      if (line !== originalLine) {
        lines[lineIdx] = line;
        modifiedLines.add(lineIdx);
        fixed++;
        source = lines.join("\n");
      }
    }

    // TS7005 - variable implicit any
    else if (error.code === "TS7005") {
      const lines = source.split("\n");
      if (lineIdx < 0 || lineIdx >= lines.length) continue;
      if (modifiedLines.has(lineIdx)) continue;
      let line = lines[lineIdx];
      const originalLine = line;

      const vm = error.message.match(/Variable '(\w+)' implicitly has an 'any' type/);
      if (!vm) continue;
      const varName = vm[1];

      // Add : any or more specific type
      if (
        line.match(new RegExp(`\\b${varName}\\s*=\\s*setInterval|\\b${varName}\\s*=\\s*setTimeout`))
      ) {
        line = line.replace(
          new RegExp(`\\b(${varName})\\s*=`),
          "$1: ReturnType<typeof setInterval> =",
        );
      } else if (line.match(new RegExp(`\\b${varName}\\s*=\\s*new\\s+`))) {
        line = line.replace(new RegExp(`\\b(${varName})\\s*=\\s*new`), "$1: any = new");
      } else {
        // Generic: let x; or let x, y;
        line = line.replace(
          new RegExp(`\\b(let|var)\\s+${varName}\\b(?=\\s*[,;])`),
          `$1 ${varName}: any`,
        );
        // const x = ...
        if (line === originalLine) {
          line = line.replace(
            new RegExp(`\\b(const)\\s+${varName}\\b(?=\\s*=)`),
            `$1 ${varName}: any`,
          );
        }
      }

      if (line !== originalLine) {
        lines[lineIdx] = line;
        modifiedLines.add(lineIdx);
        fixed++;
        source = lines.join("\n");
      }
    }

    // TS7034 - generic type needs explicit
    else if (error.code === "TS7034") {
      const lines = source.split("\n");
      if (lineIdx < 0 || lineIdx >= lines.length) continue;
      if (modifiedLines.has(lineIdx)) continue;
      let line = lines[lineIdx];
      const originalLine = line;

      if (line.includes("new Set()")) line = line.replace(/new Set\(\)/g, "new Set<any>()");
      if (line.includes("new Map()")) line = line.replace(/new Map\(\)/g, "new Map<any, any>()");
      // let x = [];  (empty array)
      if (line.match(/(let|const|var)\s+\w+\s*=\s*\[\s*\]/)) {
        line = line.replace(/(=\s*)\[(\s*)\]/g, `$1[] as any[]$2`);
      }

      if (line !== originalLine) {
        lines[lineIdx] = line;
        modifiedLines.add(lineIdx);
        fixed++;
        source = lines.join("\n");
      }
    }

    // TS7018 - object literal implicit any
    else if (error.code === "TS7018") {
      const lines = source.split("\n");
      if (lineIdx < 0 || lineIdx >= lines.length) continue;
      if (modifiedLines.has(lineIdx)) continue;
      let line = lines[lineIdx];
      const originalLine = line;

      const m = line.match(/^( *)(const|let|var)\s+(\w+)\s*=\s*\{/);
      if (m) {
        const keyword = m[2];
        const varName = m[3];
        line = line.replace(
          `${keyword} ${varName} = {`,
          `${keyword} ${varName}: Record<string, any> = {`,
        );
      }

      if (line !== originalLine) {
        lines[lineIdx] = line;
        modifiedLines.add(lineIdx);
        fixed++;
        source = lines.join("\n");
      }
    }

    // TS7053 - string index into typed object
    else if (error.code === "TS7053") {
      const lines = source.split("\n");
      if (lineIdx < 0 || lineIdx >= lines.length) continue;
      if (modifiedLines.has(lineIdx)) continue;
      let line = lines[lineIdx];
      const originalLine = line;

      const bracketMatches = Array.from(line.matchAll(/(\w+)\[([^\]]+)\]/g));
      for (const bm of bracketMatches) {
        const objName = bm[1];
        const indexExpr = bm[2].trim();
        const fullMatch = bm[0];
        if (fullMatch.includes("as keyof typeof") || fullMatch.includes(" as ")) continue;
        // Don't apply to string literal keys like obj["key"]
        const replacement = `${objName}[${indexExpr} as keyof typeof ${objName}]`;
        if (!line.includes(replacement)) {
          line = line.replace(fullMatch, replacement);
        }
      }

      if (line !== originalLine) {
        lines[lineIdx] = line;
        modifiedLines.add(lineIdx);
        fixed++;
        source = lines.join("\n");
      }
    }

    // TS7010 - lacks return-type annotation
    else if (error.code === "TS7010") {
      const lines = source.split("\n");
      if (lineIdx < 0 || lineIdx >= lines.length) continue;
      if (modifiedLines.has(lineIdx)) continue;
      let line = lines[lineIdx];
      const originalLine = line;

      const rm = error.message.match(/'(.+?)', which lacks return-type annotation/);
      if (!rm) continue;
      const funcName = rm[1];
      if (line.match(new RegExp(`function\\s+${funcName}\\s*\\([^)]*\\)\\s*\\{`))) {
        line = line.replace(new RegExp(`(function\\s+${funcName}\\s*\\([^)]*\\))`), "$1: any");
      }

      if (line !== originalLine) {
        lines[lineIdx] = line;
        modifiedLines.add(lineIdx);
        fixed++;
        source = lines.join("\n");
      }
    }

    // TS7023 - implicitly has return type 'any' (recursive)
    else if (error.code === "TS7023") {
      const lines = source.split("\n");
      if (lineIdx < 0 || lineIdx >= lines.length) continue;
      if (modifiedLines.has(lineIdx)) continue;
      let line = lines[lineIdx];
      const originalLine = line;

      const nm = error.message.match(/'(\w+)' implicitly has return type/);
      if (!nm) continue;
      const funcName = nm[1];
      // const name = (...) => { -> const name = (...): any => {
      if (line.match(new RegExp(`(const|let|var)\\s+${funcName}\\s*=\\s*\\(`))) {
        // Add : any after the params, before the =>
        line = line.replace(new RegExp(`(${funcName}\\s*=\\s*\\([^)]*\\))`), "$1: any");
      }

      if (line !== originalLine) {
        lines[lineIdx] = line;
        modifiedLines.add(lineIdx);
        fixed++;
        source = lines.join("\n");
      }
    }

    // TS2538 - unknown can't be used as index type
    else if (error.code === "TS2538") {
      const lines = source.split("\n");
      if (lineIdx < 0 || lineIdx >= lines.length) continue;
      if (modifiedLines.has(lineIdx)) continue;
      let line = lines[lineIdx];
      const originalLine = line;

      // Object.entries().map(([key, val]) => key is unknown
      // Add as string
      // This is tricky mechanically, skip for now
      continue;
    }
  }

  if (fixed > 0) {
    writeFileSync(filePath, source, "utf-8");
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
}

console.log(`\nDone. Fixed: ${totalFixed} errors.`);
