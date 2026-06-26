/**
 * fix-no-implicit-any-v2.ts
 * Targeted mechanical fixes for noImplicitAny TypeScript errors.
 * Usage: bun run scripts/fix-no-implicit-any-v2.ts
 * 
 * Fixed from v1: TS7053 now correctly uses the object name from the expression.
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
 * TS7006: Parameter implicitly has 'any' type.
 */
function fixTS7006(filePath: string, errors: TSError[]): number {
  let source = readFileSync(filePath, "utf-8");
  const lines = source.split("\n");
  let fixed = 0;

  for (const error of errors) {
    const lineIdx = error.line - 1;
    if (lineIdx < 0 || lineIdx >= lines.length) continue;
    let line = lines[lineIdx];

    const pm = error.message.match(/Parameter '(\w+)' implicitly has an 'any' type/);
    if (!pm) continue;
    const pn = pm[1];

    // Skip if param already has a type
    if (line.match(new RegExp(`\\b${pn}\\s*:\\s*\\w`))) continue;

    // catch (e) -> catch (e: any)
    if (line.match(new RegExp(`catch\\s*\\(\\s*${pn}\\s*\\)`))) {
      line = line.replace(new RegExp(`(catch\\s*\\(\\s*)(${pn})(\\s*\\))`), "$1$2: any$3");
    }
    // Single arrow param in callback chains: .map(x =>  .filter(x =>  .then(x => etc
    else if (line.match(new RegExp(`\\.(map|filter|forEach|then|catch|reduce|some|every|find|findIndex|flatMap|sort|toSorted)\\s*\\(\\s*${pn}\\s*(,|=>)`))) {
      line = line.replace(new RegExp(`(\\.(?:map|filter|forEach|then|catch|reduce|some|every|find|findIndex|flatMap|sort|toSorted)\\s*\\()(${pn})(\\s*(?:,|=>))`), "$1$2: any$3");
    }
    // General: replace paramName with paramName: any when followed by , ) or =>
    else {
      const before = line;
      // Match paramName followed by , ) or => (but not within a string or comment)
      line = line.replace(new RegExp(`\\b${pn}\\b(?=\\s*[,)\\]])`), `${pn}: any`);
      // Also handle => case
      if (line === before) {
        line = line.replace(new RegExp(`\\b${pn}\\b(?=\\s*\\)\\s*=>)`), `${pn}: any`);
      }
    }

    if (line !== lines[lineIdx]) {
      lines[lineIdx] = line;
      fixed++;
    }
  }

  if (fixed > 0) {
    writeFileSync(filePath, lines.join("\n"), "utf-8");
  }
  return fixed;
}

/**
 * TS7031: Binding element implicitly has 'any' type.
 * e.g., ({ params }) => needs type annotation
 */
function fixTS7031(filePath: string, errors: TSError[]): number {
  let source = readFileSync(filePath, "utf-8");
  const lines = source.split("\n");
  let fixed = 0;

  for (const error of errors) {
    const lineIdx = error.line - 1;
    if (lineIdx < 0 || lineIdx >= lines.length) continue;
    let line = lines[lineIdx];

    const bm = error.message.match(/Binding element '(\w+)' implicitly has an 'any' type/);
    if (!bm) continue;
    const key = bm[1];

    // Look for { key } or { key, ... } pattern (destructured object)
    // Pattern: { key } -> { key }: { key: any }
    // Pattern: { key1, key2 } -> { key1, key2 }: { key1: any; key2: any }
    const destructured = line.match(/\{\s*([^}]+)\s*\}/);
    if (destructured) {
      const inner = destructured[1].trim();
      const keys = inner.split(",").map((k) => k.trim()).filter(Boolean);
      // Check if this really is a parameter (followed by ) or =>
      if (/\}\s*\)/.test(line) || /\}\s*=>/.test(line)) {
        const typeLiteral = "{ " + keys.map((k) => `${k}: any`).join("; ") + " }";
        line = line.replace(destructured[0], `{ ${inner} }: ${typeLiteral}`);
      }
    }

    if (line !== lines[lineIdx]) {
      lines[lineIdx] = line;
      fixed++;
    }
  }

  if (fixed > 0) {
    writeFileSync(filePath, lines.join("\n"), "utf-8");
  }
  return fixed;
}

/**
 * TS7053: string can't be used to index type.
 * Extract the object name from the bracket expression.
 * e.g., sizes[size] -> sizes[size as keyof typeof sizes]
 */
function fixTS7053(filePath: string, errors: TSError[]): number {
  let source = readFileSync(filePath, "utf-8");
  const lines = source.split("\n");
  let fixed = 0;

  for (const error of errors) {
    const lineIdx = error.line - 1;
    if (lineIdx < 0 || lineIdx >= lines.length) continue;
    let line = lines[lineIdx];

    // The error message format: 
    // "Element implicitly has an 'any' type because expression of type 'string' can't be used to index type '{...}'"
    // Or: "Element implicitly has an 'any' type because expression of type 'any' can't be used to index type '{}'"
    // Or: "Element implicitly has an 'any' type because expression of type 'string | number | symbol' can't be used to index type '...'"
    
    // Find the bracket access in the line around the error col
    // Look for pattern: objectName[expression]
    const bracketMatches = Array.from(line.matchAll(/(\w+)\[([^\]]+)\]/g));
    
    for (const bm of bracketMatches) {
      const objName = bm[1];
      const indexExpr = bm[2].trim();
      const fullMatch = bm[0];
      
      // Check if this is the problematic expression (not already cast)
      if (fullMatch.includes("as keyof typeof") || fullMatch.includes("as ")) continue;
      
      // Check if the object is likely a typed record (style map, config, etc.)
      // We want to add: objName[indexExpr as keyof typeof objName]
      const replacement = `${objName}[${indexExpr} as keyof typeof ${objName}]`;
      
      // Only replace if not already fixed
      if (line.includes(replacement)) continue;
      
      line = line.replace(fullMatch, replacement);
    }

    if (line !== lines[lineIdx]) {
      lines[lineIdx] = line;
      fixed++;
    }
  }

  if (fixed > 0) {
    writeFileSync(filePath, lines.join("\n"), "utf-8");
  }
  return fixed;
}

/**
 * TS7018: Object literal's property implicitly has any type.
 */
function fixTS7018(filePath: string, errors: TSError[]): number {
  let source = readFileSync(filePath, "utf-8");
  const lines = source.split("\n");
  let fixed = 0;

  for (const error of errors) {
    const lineIdx = error.line - 1;
    if (lineIdx < 0 || lineIdx >= lines.length) continue;
    let line = lines[lineIdx];

    // const/let varName = { ... }
    const m = line.match(/^( *)(const|let|var)\s+(\w+)\s*=\s*\{/);
    if (m) {
      const keyword = m[2];
      const varName = m[3];
      line = line.replace(`${keyword} ${varName} = {`, `${keyword} ${varName}: Record<string, any> = {`);
    }

    if (line !== lines[lineIdx]) {
      lines[lineIdx] = line;
      fixed++;
    }
  }

  if (fixed > 0) {
    writeFileSync(filePath, lines.join("\n"), "utf-8");
  }
  return fixed;
}

/**
 * TS7034: Variable implicitly has type 'any'.
 */
function fixTS7034(filePath: string, errors: TSError[]): number {
  let source = readFileSync(filePath, "utf-8");
  const lines = source.split("\n");
  let fixed = 0;

  for (const error of errors) {
    const lineIdx = error.line - 1;
    if (lineIdx < 0 || lineIdx >= lines.length) continue;
    let line = lines[lineIdx];

    if (line.includes("new Set()")) {
      line = line.replace(/new Set\(\)/g, "new Set<any>()");
    }
    if (line.includes("new Map()")) {
      line = line.replace(/new Map\(\)/g, "new Map<any, any>()");
    }

    if (line !== lines[lineIdx]) {
      lines[lineIdx] = line;
      fixed++;
    }
  }

  if (fixed > 0) {
    writeFileSync(filePath, lines.join("\n"), "utf-8");
  }
  return fixed;
}

/**
 * TS7005: Variable implicitly has 'any' type.
 */
function fixTS7005(filePath: string, errors: TSError[]): number {
  let source = readFileSync(filePath, "utf-8");
  const lines = source.split("\n");
  let fixed = 0;

  for (const error of errors) {
    const lineIdx = error.line - 1;
    if (lineIdx < 0 || lineIdx >= lines.length) continue;
    let line = lines[lineIdx];

    const vm = error.message.match(/Variable '(\w+)' implicitly has an 'any' type/);
    if (!vm) continue;
    const varName = vm[1];

    // setInterval/setTimeout
    if (line.match(new RegExp(`\\b${varName}\\s*=\\s*setInterval|\\b${varName}\\s*=\\s*setTimeout`))) {
      line = line.replace(new RegExp(`(${varName})\\s*=`), "$1: ReturnType<typeof setInterval> =");
    }
    // Generic variable used later
    else if (line.match(new RegExp(`(let|var)\\s+${varName}[,;\\s]`))) {
      line = line.replace(new RegExp(`\\b${varName}\\b(?=[,;\\s])`), `${varName}: any`);
    }

    if (line !== lines[lineIdx]) {
      lines[lineIdx] = line;
      fixed++;
    }
  }

  if (fixed > 0) {
    writeFileSync(filePath, lines.join("\n"), "utf-8");
  }
  return fixed;
}

/**
 * TS7010: 'x' lacks return-type annotation.
 */
function fixTS7010(filePath: string, errors: TSError[]): number {
  let source = readFileSync(filePath, "utf-8");
  const lines = source.split("\n");
  let fixed = 0;

  for (const error of errors) {
    const lineIdx = error.line - 1;
    if (lineIdx < 0 || lineIdx >= lines.length) continue;
    let line = lines[lineIdx];

    const rm = error.message.match(/'(.+?)', which lacks return-type annotation/);
    if (!rm) continue;
    const funcName = rm[1];

    // function declaration
    if (line.match(new RegExp(`function\\s+${funcName}\\s*\\([^)]*\\)\\s*\\{`))) {
      line = line.replace(
        new RegExp(`(function\\s+${funcName}\\s*\\([^)]*\\))`),
        "$1: any"
      );
    }

    if (line !== lines[lineIdx]) {
      lines[lineIdx] = line;
      fixed++;
    }
  }

  if (fixed > 0) {
    writeFileSync(filePath, lines.join("\n"), "utf-8");
  }
  return fixed;
}

/**
 * TS7023: 'x' implicitly has return type 'any' because it does not have a return type
 * annotation and is referenced directly or indirectly in one of its return expressions.
 */
function fixTS7023(filePath: string, errors: TSError[]): number {
  let source = readFileSync(filePath, "utf-8");
  const lines = source.split("\n");
  let fixed = 0;

  for (const error of errors) {
    const lineIdx = error.line - 1;
    if (lineIdx < 0 || lineIdx >= lines.length) continue;
    let line = lines[lineIdx];

    const nm = error.message.match(/'(\w+)' implicitly has return type/);
    if (!nm) continue;
    const funcName = nm[1];

    // const name = (...) => { -> const name = (...): any => {
    if (line.match(new RegExp(`(const|let|var)\\s+${funcName}\\s*=\\s*\\(`))) {
      line = line.replace(
        new RegExp(`(${funcName}\\s*=)\\s*(\\([^)]*\\)\\s*=>)`),
        "$1 $2: any"
      );
    }

    if (line !== lines[lineIdx]) {
      lines[lineIdx] = line;
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
  const codes = [...new Set(errors.map(e => e.code))];
  let fileFixed = 0;

  for (const code of codes) {
    const codeErrors = errors.filter(e => e.code === code);
    let f = 0;
    switch (code) {
      case "TS7006": f = fixTS7006(file, codeErrors); break;
      case "TS7031": f = fixTS7031(file, codeErrors); break;
      case "TS7053": f = fixTS7053(file, codeErrors); break;
      case "TS7018": f = fixTS7018(file, codeErrors); break;
      case "TS7034": f = fixTS7034(file, codeErrors); break;
      case "TS7005": f = fixTS7005(file, codeErrors); break;
      case "TS7010": f = fixTS7010(file, codeErrors); break;
      case "TS7023": f = fixTS7023(file, codeErrors); break;
    }
    fileFixed += f;
    totalFixed += f;
  }
}

console.log(`\nDone. Fixed: ${totalFixed} errors.`);
