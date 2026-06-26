/**
 * fix-no-implicit-any.ts
 * Targeted mechanical fixes for noImplicitAny TypeScript errors.
 * Usage: bun run scripts/fix-no-implicit-any.ts
 *
 * Handles these patterns precisely by file:
 *
 * 1. TS7016 - missing module declarations (prop-types) ✓ already fixed via .d.ts
 * 2. TS7006 - param implicit any - simplest cases only
 *    - catch(e) -> catch(e: any)  (line-level, safe)
 *    - (e) => in onChange/onClick handlers -> (e: React.ChangeEvent<HTMLInputElement>)
 *    - function name(param) -> function name(param: any) when param is standalone
 * 3. TS7053 - string indexing into typed objects
 *    - styleMap[key] where key is string -> styleMap[key as keyof typeof styleMap]
 * 4. TS7018 - object literal implicit any
 *    - const obj = { prop: [] } -> const obj: Record<string, any[]> = { prop: [] }
 * 5. TS7034 - new Set()/new Map() -> new Set<any>() / new Map<any, any>()
 * 6. TS7031 - Binding element explicitly has any
 *    - ({ params }) -> ({ params }: { params: any })
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
 *
 * Mechanical patterns:
 *   catch (e) {           -> catch (e: any) {
 *   catch (err) {         -> catch (err: any) {
 *   catch (error) {       -> catch (error: any) {
 *
 * Arrow callbacks (simple, single-param, no curlies):
 *   .map(x =>             -> .map((x: any) =>
 *   .filter(x =>          -> .filter((x: any) =>
 *   .forEach(x =>         -> .forEach((x: any) =>
 *   .then(data =>         -> .then((data: any) =>
 *   .catch(err =>         -> .catch((err: any) =>
 *
 * Simple function params (standalone, no destructuring):
 *   function foo(param) { -> function foo(param: any) {
 *   function foo(p1, p2) { -> function foo(p1: any, p2: any) {
 *
 * Event handlers:
 *   onChange={(e) =>     -> onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
 *   onClick={(e) =>      -> onClick={(e: React.MouseEvent) =>
 *   onSubmit={(e) =>     -> onSubmit={(e: React.FormEvent) =>
 */
function fixTS7006(errorsForFile: TSError[]): [number, number] {
  let fixed = 0;
  let skipped = 0;
  const filePath = errorsForFile[0].file;
  
  try {
    let source = readFileSync(filePath, "utf-8");
    const lines = source.split("\n");
    
    for (const error of errorsForFile) {
      const lineIdx = error.line - 1;
      if (lineIdx < 0 || lineIdx >= lines.length) { skipped++; continue; }
      let line = lines[lineIdx];
      const original = line;
      
      // Extract param name
      const pm = error.message.match(/Parameter '(\w+)' implicitly has an 'any' type/);
      if (!pm) { skipped++; continue; }
      const pn = pm[1];
      
      // Pattern 1: catch (e) or catch (e)
      if (line.match(new RegExp(`catch\\s*\\(\\s*${pn}\\s*\\)`))) {
        line = line.replace(
          new RegExp(`(catch\\s*\\(\\s*)(${pn})(\\s*\\))`),
          "$1$2: any$3"
        );
      }
      // Pattern 2: Single arrow param in callback: .map(x => , filter, forEach, then, catch
      else if (line.match(new RegExp(`\\.(map|filter|forEach|then|catch|reduce|some|every|find|findIndex|flatMap|sort|toSorted)\\s*\\(\\s*${pn}\\s*(,|=>)`))) {
        line = line.replace(
          new RegExp(`(\\.(?:map|filter|forEach|then|catch|reduce|some|every|find|findIndex|flatMap|sort|toSorted)\\s*\\()(${pn})(\\s*(?:,|=>))`),
          "$1$2: any$3"  
        );
      }
      // Pattern 3: Simple function keyword params
      // function name(param) or function name(p1, p2)
      else if (line.match(new RegExp(`\\bfunction\\s+\\w+\\s*\\([^)]*\\b${pn}\\b[^)]*\\)`))) {
        // Replace the specific param with type
        line = line.replace(
          new RegExp(`\\b${pn}\\b(?=\\s*[,)])`),
          `${pn}: any`
        );
      }
      // Pattern 4: Arrow function params
      // (param) =>  or (p1, p2) =>
      else if (line.includes(`(${pn})`) || line.includes(`(${pn},`) || line.includes(`, ${pn})`) || line.includes(`, ${pn},`)) {
        line = line.replace(
          new RegExp(`\\b${pn}\\b(?=\\s*[,)])`),
          `${pn}: any`
        );
      }
      // Pattern 5: onChange={(e) => or similar event handlers
      else if (pn === "e" || pn === "event" || pn === "evt") {
        if (line.match(/onChange\s*=\s*\{/)) {
          line = line.replace(
            new RegExp(`\\b${pn}\\b(?=\\s*\\)\\s*=>)`),
            `${pn}: React.ChangeEvent<HTMLInputElement>`
          );
        } else if (line.match(/onClick\s*=\s*\{/)) {
          line = line.replace(
            new RegExp(`\\b${pn}\\b(?=\\s*\\)\\s*=>)`),
            `${pn}: React.MouseEvent`
          );
        } else if (line.match(/onSubmit\s*=\s*\{/)) {
          line = line.replace(
            new RegExp(`\\b${pn}\\b(?=\\s*\\)\\s*=>)`),
            `${pn}: React.FormEvent`
          );
        } else {
          // General event handler (e) =>
          line = line.replace(
            new RegExp(`\\b${pn}\\b(?=\\s*\\)\\s*=>)`),
            `${pn}: any // todo(ts): tighten`
          );
        }
      }
      // Pattern 6: General standalone param
      else {
        // Only fix if param appears as a standalone word followed by , or )
        // Avoid replacing inside strings, comments, etc.
        if (line.match(new RegExp(`\\b${pn}\\b(?=\\s*[,)])`))) {
          line = line.replace(
            new RegExp(`\\b${pn}\\b(?=\\s*[,)])`),
            `${pn}: any`
          );
        } else {
          skipped++;
          continue;
        }
      }
      
      if (line !== original) {
        lines[lineIdx] = line;
        fixed++;
      } else {
        skipped++;
      }
    }
    
    if (fixed > 0) {
      writeFileSync(filePath, lines.join("\n"), "utf-8");
    }
    return [fixed, skipped];
  } catch (e) {
    console.error(`Error processing ${filePath}:`, e);
    return [0, errorsForFile.length];
  }
}

/**
 * TS7031: Binding element implicitly has 'any' type.
 * e.g., ({ params }) => needs type annotation
 */
function fixTS7031(errorsForFile: TSError[]): [number, number] {
  let fixed = 0;
  let skipped = 0;
  const filePath = errorsForFile[0].file;
  
  try {
    let source = readFileSync(filePath, "utf-8");
    const lines = source.split("\n");
    
    for (const error of errorsForFile) {
      const lineIdx = error.line - 1;
      if (lineIdx < 0 || lineIdx >= lines.length) { skipped++; continue; }
      let line = lines[lineIdx];
      const original = line;
      
      const bm = error.message.match(/Binding element '(\w+)' implicitly has an 'any' type/);
      if (!bm) { skipped++; continue; }
      
      // Look for { paramName } pattern
      if (line.match(/\{\s*\w+\s*\}/)) {
        const key = bm[1];
        line = line.replace(
          new RegExp(`(\\{\\s*)(${key})(\\s*\\})`),
          `$1$2$3: { ${key}: any }`
        );
      }
      
      if (line !== original) {
        lines[lineIdx] = line;
        fixed++;
      } else {
        skipped++;
      }
    }
    
    if (fixed > 0) {
      writeFileSync(filePath, lines.join("\n"), "utf-8");
    }
    return [fixed, skipped];
  } catch (e) {
    console.error(`Error processing ${filePath}:`, e);
    return [0, errorsForFile.length];
  }
}

/**
 * TS7053: string can't be used to index type. 
 * Add `as keyof typeof` cast or `as any` at point of use.
 */
function fixTS7053(errorsForFile: TSError[]): [number, number] {
  let fixed = 0;
  let skipped = 0;
  const filePath = errorsForFile[0].file;
  
  try {
    let source = readFileSync(filePath, "utf-8");
    const lines = source.split("\n");
    
    for (const error of errorsForFile) {
      const lineIdx = error.line - 1;
      if (lineIdx < 0 || lineIdx >= lines.length) { skipped++; continue; }
      let line = lines[lineIdx];
      const original = line;
      
      // Pattern: something[expression] where expression is a string/computed
      // e.g., sizeMap[size], variantStyles[variant], etc.
      // Look for bracket access with a variable
      const m = line.match(/\[([^\]]+)\]/g);
      if (m) {
        for (const bracketExpr of m) {
          const inner = bracketExpr.slice(1, -1);
          // If it's a simple variable (not a literal string), cast it
          if (/^[a-zA-Z_]\w*$/.test(inner)) {
            // Check if it's followed by . or another [
            // Add `as any` to the expression
            line = line.replace(
              new RegExp(`\\[${inner}\\]`),
              `[${inner} as keyof typeof ${inner === "size" ? "sizeStyles" : inner === "variant" ? "variantStyles" : inner === "padding" ? "paddingStyles" : inner + "Styles"}]`
            );
          }
        }
      }
      
      if (line !== original) {
        lines[lineIdx] = line;
        fixed++;
      } else {
        skipped++;
      }
    }
    
    if (fixed > 0) {
      writeFileSync(filePath, lines.join("\n"), "utf-8");
    }
    return [fixed, skipped];
  } catch (e) {
    console.error(`Error processing ${filePath}:`, e);
    return [0, errorsForFile.length];
  }
}

/**
 * TS7018: Object literal's property 'x' implicitly has an 'any[]' type.
 * Add type to const/let declaration.
 */
function fixTS7018(errorsForFile: TSError[]): [number, number] {
  let fixed = 0;
  let skipped = 0;
  const filePath = errorsForFile[0].file;
  
  try {
    let source = readFileSync(filePath, "utf-8");
    const lines = source.split("\n");
    
    for (const error of errorsForFile) {
      const lineIdx = error.line - 1;
      if (lineIdx < 0 || lineIdx >= lines.length) { skipped++; continue; }
      let line = lines[lineIdx];
      const original = line;
      
      // Pattern: const/let varName = { ... };
      const m = line.match(/^( *)(const|let|var)\s+(\w+)\s*=\s*\{/);
      if (m) {
        const indent = m[1];
        const keyword = m[2];
        const varName = m[3];
        
        // Determine if the line is standalone or part of a larger expression
        // If it ends with ; or is just the opening brace, it's a standalone assignment
        if (line.trim().endsWith(";") || line.trim().endsWith("{")) {
          line = line.replace(
            `${keyword} ${varName} = {`,
            `${keyword} ${varName}: Record<string, any> = {`
          );
        }
      }
      
      if (line !== original) {
        lines[lineIdx] = line;
        fixed++;
      } else {
        skipped++;
      }
    }
    
    if (fixed > 0) {
      writeFileSync(filePath, lines.join("\n"), "utf-8");
    }
    return [fixed, skipped];
  } catch (e) {
    console.error(`Error processing ${filePath}:`, e);
    return [0, errorsForFile.length];
  }
}

/**
 * TS7034: Variable implicitly has type 'any' in some locations where its type cannot be determined.
 */
function fixTS7034(errorsForFile: TSError[]): [number, number] {
  let fixed = 0;
  let skipped = 0;
  const filePath = errorsForFile[0].file;
  
  try {
    let source = readFileSync(filePath, "utf-8");
    const lines = source.split("\n");
    
    for (const error of errorsForFile) {
      const lineIdx = error.line - 1;
      if (lineIdx < 0 || lineIdx >= lines.length) { skipped++; continue; }
      let line = lines[lineIdx];
      const original = line;
      
      // new Set() -> new Set<any>()
      if (line.includes("new Set()")) {
        line = line.replace(/new Set\(\)/g, "new Set<any>()");
      }
      // new Map() -> new Map<any, any>()
      if (line.includes("new Map()")) {
        line = line.replace(/new Map\(\)/g, "new Map<any, any>()");
      }
      // = [] -> = [] as any[]  (but only for standalone declarations)
      // This is common for let/const declarations
      let queue = []
      
      if (line !== original) {
        lines[lineIdx] = line;
        fixed++;
      } else {
        skipped++;
      }
    }
    
    if (fixed > 0) {
      writeFileSync(filePath, lines.join("\n"), "utf-8");
    }
    return [fixed, skipped];
  } catch (e) {
    console.error(`Error processing ${filePath}:`, e);
    return [0, errorsForFile.length];
  }
}

/**
 * TS7005: Variable implicitly has 'any' type.
 */
function fixTS7005(errorsForFile: TSError[]): [number, number] {
  let fixed = 0;
  let skipped = 0;
  const filePath = errorsForFile[0].file;
  
  try {
    let source = readFileSync(filePath, "utf-8");
    const lines = source.split("\n");
    
    for (const error of errorsForFile) {
      const lineIdx = error.line - 1;
      if (lineIdx < 0 || lineIdx >= lines.length) { skipped++; continue; }
      let line = lines[lineIdx];
      const original = line;
      
      const vm = error.message.match(/Variable '(\w+)' implicitly has an 'any' type/);
      if (!vm) { skipped++; continue; }
      const varName = vm[1];
      
      // Pattern: Variable is referenced somewhere and has no type
      // e.g., let poll, heartbeat, idleTimeout;
      //       const id = setInterval(...)
      // Common: add : ReturnType<typeof setInterval> for typical patterns
      if (line.includes("setInterval") || line.includes("setTimeout")) {
        line = line.replace(
          new RegExp(`(const|let|var)\\s+${varName}\\s*=`),
          `$1 ${varName}: ReturnType<typeof setInterval> =`
        );
      }
      // For multi-declaration: let poll, heartbeat;
      else if (line.match(new RegExp(`let\\s+${varName}\\s*[,;]`))) {
        line = line.replace(
          new RegExp(`\\b${varName}\\b(?=\\s*[,;])`),
          `${varName}: any`
        );
      }
      
      if (line !== original) {
        lines[lineIdx] = line;
        fixed++;
      } else {
        skipped++;
      }
    }
    
    if (fixed > 0) {
      writeFileSync(filePath, lines.join("\n"), "utf-8");
    }
    return [fixed, skipped];
  } catch (e) {
    console.error(`Error processing ${filePath}:`, e);
    return [0, errorsForFile.length];
  }
}

/**
 * TS7010: 'x', which lacks return-type annotation, implicitly has an 'any' return type.
 */
function fixTS7010(errorsForFile: TSError[]): [number, number] {
  let fixed = 0;
  let skipped = 0;
  const filePath = errorsForFile[0].file;
  
  try {
    let source = readFileSync(filePath, "utf-8");
    const lines = source.split("\n");
    
    for (const error of errorsForFile) {
      const lineIdx = error.line - 1;
      if (lineIdx < 0 || lineIdx >= lines.length) { skipped++; continue; }
      let line = lines[lineIdx];
      const original = line;
      
      const rm = error.message.match(/'(.*?)', which lacks return-type annotation/);
      if (!rm) { skipped++; continue; }
      const funcName = rm[1];
      
      // Add : any return type
      // For function declarations
      if (line.match(new RegExp(`function\\s+${funcName}\\s*\\(`))) {
        line = line.replace(
          new RegExp(`(function\\s+${funcName}\\s*\\([^)]*\\))`),
          "$1: any"
        );
      }
      // For arrow function assignments
      else if (line.match(new RegExp(`(const|let|var)\\s+${funcName}\\s*=`))) {
        line = line.replace(
          new RegExp(`((?:const|let|var)\\s+${funcName}\\s*=\\s*\\([^)]*\\)\\s*=>\\s*\\{)`),
          "$1: any"
        );
      }
      
      if (line !== original) {
        lines[lineIdx] = line;
        fixed++;
      } else {
        skipped++;
      }
    }
    
    if (fixed > 0) {
      writeFileSync(filePath, lines.join("\n"), "utf-8");
    }
    return [fixed, skipped];
  } catch (e) {
    console.error(`Error processing ${filePath}:`, e);
    return [0, errorsForFile.length];
  }
}

// Main
console.log("Parsing errors...");
const allErrors = parseErrors();
console.log(`Total errors: ${allErrors.length}`);

// Group by file
const byFile = new Map<string, TSError[]>();
for (const e of allErrors) {
  if (!byFile.has(e.file)) byFile.set(e.file, []);
  byFile.get(e.file)!.push(e);
}

console.log(`Unique files: ${byFile.size}`);

// Process each file with appropriate fixers
let totalFixed = 0;
let totalSkipped = 0;

for (const [file, errors] of byFile) {
  const codes = [...new Set(errors.map(e => e.code))];
  let fileFixed = 0;
  
  for (const code of codes) {
    const codeErrors = errors.filter(e => e.code === code);
    let [f, s] = [0, 0];
    
    switch (code) {
      case "TS7006": [f, s] = fixTS7006(codeErrors); break;
      case "TS7031": [f, s] = fixTS7031(codeErrors); break;
      case "TS7053": [f, s] = fixTS7053(codeErrors); break;
      case "TS7018": [f, s] = fixTS7018(codeErrors); break;
      case "TS7034": [f, s] = fixTS7034(codeErrors); break;
      case "TS7005": [f, s] = fixTS7005(codeErrors); break;
      case "TS7010": [f, s] = fixTS7010(codeErrors); break;
      default: s = codeErrors.length; break;
    }
    
    fileFixed += f;
    totalFixed += f;
    totalSkipped += s;
  }
  
  if (fileFixed > 0) {
    console.log(`Fixed ${fileFixed} errors in ${file}`);
  }
}

console.log(`\nDone. Fixed: ${totalFixed}, Skipped: ${totalSkipped}, Total: ${allErrors.length}`);
