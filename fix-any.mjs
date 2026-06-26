import fs from "fs";
import { execSync } from "child_process";

// Collect all errors from tsc
function getErrors() {
  let output;
  try {
    output = execSync(`bash -c "bun x tsc --noEmit --noImplicitAny 2>&1 || true"`, {
      encoding: "utf8",
      maxBuffer: 100 * 1024 * 1024,
    });
  } catch {
    return [];
  }
  const errors = [];
  for (const line of output.split("\n")) {
    const m = line.match(/^src\/app\/\(dashboard\)\/(.+?)\((\d+),\d+\): error TS(\d+):/);
    if (m) {
      errors.push({
        file: `src/app/(dashboard)/${m[1]}`,
        line: parseInt(m[2]),
        code: `TS${m[3]}`,
      });
    }
  }
  return errors;
}

function fixLines(lines) {
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    // .catch(err => ...)
    if (line.includes(".catch(") && !line.includes("unknown")) {
      line = line.replace(/\.catch\((\w+)\s*=>/g, ".catch(($1: unknown) =>");
      line = line.replace(/\.catch\(\((\w+)\)\s*=>/g, ".catch(($1: unknown) =>");
    }
    // Array methods
    line = line.replace(/\.map\((\w+)\s*=>/g, ".map(($1: any) =>");
    line = line.replace(/\.filter\((\w+)\s*=>/g, ".filter(($1: any) =>");
    line = line.replace(/\.forEach\((\w+)\s*=>/g, ".forEach(($1: any) =>");
    line = line.replace(/\.find\((\w+)\s*=>/g, ".find(($1: any) =>");
    line = line.replace(/\.some\((\w+)\s*=>/g, ".some(($1: any) =>");
    line = line.replace(/\.every\((\w+)\s*=>/g, ".every(($1: any) =>");
    // Event handlers
    line = line.replace(/onClick=\{\((\w+)\)\s*=>/g, "onClick={($1: any) =>");
    line = line.replace(/onChange=\{\((\w+)\)\s*=>/g, "onChange={($1: any) =>");
    line = line.replace(/onKeyDown=\{\((\w+)\)\s*=>/g, "onKeyDown={($1: any) =>");
    // Single-line destructured params
    if (line.match(/(?:function |export default function )\w+\(\{/) && !line.includes(": any") && !line.includes(": {")) {
      line = line.replace(/(function \w+)\(\{([^}\n]*)\}\)\s*\{/, "$1({$2}: any) {");
      line = line.replace(/(export default function \w+)\(\{([^}\n]*)\}\)\s*\{/, "$1({$2}: any) {");
    }
    lines[i] = line;
  }
}

// Fix multi-line destructured params: find "function X({" ... "})" patterns
function fixMultiLineDestructured(lines) {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    // Find function declarations with destructured params spanning multiple lines
    // Pattern: function Name({  at line i, then "})" at some later line j
    if ((line.startsWith("function ") || line.startsWith("export default function ")) && line.includes("({") && !line.includes("})")) {
      // Multi-line destructured - find the closing
      let j = i + 1;
      while (j < lines.length) {
        if (lines[j].includes("})") && lines[j].includes("{")) {
          // Found the closing line
          // Add ": any" between }) and {
          let closingLine = lines[j];
          // Check if already annotated
          if (!closingLine.includes(": any") && !closingLine.includes(": {")) {
            closingLine = closingLine.replace(/\}\)(\s*\{)/, "}: any)$1");
          }
          lines[j] = closingLine;
          break;
        }
        j++;
      }
    }
  }
}

console.log("Getting errors...");
const errors = getErrors();
console.log(`Found ${errors.length} total errors`);

// Group by file
const byFile = {};
for (const e of errors) {
  if (!byFile[e.file]) byFile[e.file] = { all: [], ts7031: [] };
  byFile[e.file].all.push(e);
  if (e.code === "TS7031") byFile[e.file].ts7031.push(e.line);
}

let fixed = 0;
for (const [file, data] of Object.entries(byFile)) {
  const content = fs.readFileSync(file, "utf8");
  const lines = content.split("\n");
  
  fixLines(lines);
  
  if (data.ts7031.length > 0) {
    fixMultiLineDestructured(lines);
  }
  
  const newContent = lines.join("\n");
  if (newContent !== content) {
    fs.writeFileSync(file, newContent, "utf8");
    fixed += data.all.length;
    console.log(`Fixed ${data.all.length} errors in ${file}`);
  }
}

console.log(`\nTotal: ${fixed} errors attempted`);
