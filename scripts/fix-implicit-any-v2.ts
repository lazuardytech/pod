import { readFileSync, writeFileSync } from "fs";
import { statSync, readdirSync } from "fs";
import { join } from "path";

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (entry === "node_modules" || entry === ".next") continue;
    if (statSync(full).isDirectory()) yield* walk(full);
    else yield full;
  }
}

const srcFiles = Array.from(walk("src")).filter(
  (f) => /\.(ts|tsx)$/.test(f) && !f.endsWith(".d.ts"),
);
const allFiles = Array.from(walk(".")).filter(
  (f) =>
    /\.(ts|tsx)$/.test(f) &&
    !f.endsWith(".d.ts") &&
    !f.includes("node_modules") &&
    !f.includes(".next"),
);

let fixes = {
  TS7006: 0,
  TS7034: 0,
  TS7005: 0,
  TS7031: 0,
  TS7053: 0,
  TS7018: 0,
  TS7016: 0,
  TS7023: 0,
};

for (const file of allFiles) {
  let content = readFileSync(file, "utf-8");
  const orig = content;

  // Helper to check if a param already has a type annotation
  // Simple heuristic: if line already has param: Type pattern, skip

  // Fix TS7006: add :any to params in arrow functions, function declarations, and methods
  // This is the main one. We use a line-by-line approach.

  const lines = content.split("\n");
  const fixedLines = [];

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    // Skip comments and JSDoc
    if (
      line.trim().startsWith("//") ||
      line.trim().startsWith("*") ||
      line.trim().startsWith("/*")
    ) {
      fixedLines.push(line);
      continue;
    }

    // Fix patterns:
    // 1. Arrow fn params: (param) => or (param, param2) =>
    // 2. catch (e) { / catch (err) {
    // 3. function name(param) {
    // 4. .then(param => ...) / .forEach(param => ...) / .map(param => ...)

    // catch block
    line = line.replace(/catch\s*\(\s*([a-zA-Z_]\w*)\s*\)\s*\{/g, (_, name) => {
      fixes.TS7016++;
      return `catch (${name}: any) {`;
    });
    line = line.replace(/catch\s*\(\s*([a-zA-Z_]\w*)\s*\)\s*$/g, (_, name) => {
      fixes.TS7016++;
      return `catch (${name}: any)`;
    });

    // .then(fn), .catch(fn), .map(fn), .filter(fn), .forEach(fn), .reduce(fn)
    // These are callbacks — single param without type
    // Pattern: then(word => / then(word,  / map(word => / filter(word =>
    for (const method of [
      "then",
      "catch",
      "map",
      "filter",
      "forEach",
      "reduce",
      "find",
      "some",
      "every",
      "flatMap",
      "sort",
    ]) {
      // Single param arrow: .method(word =>
      const singleParamRe = new RegExp(`\\.${method}\\s*\\(\\s*([a-zA-Z_$]\\w*)\\s*=>`, "g");
      line = line.replace(singleParamRe, (m, param) => {
        fixes.TS7006++;
        return `.${method}((${param}: any) =>`;
      });
      // Single param arrow with function body: .method(function(word) {
      const funcRe = new RegExp(
        `\\.${method}\\s*\\(\\s*function\\s*\\(\\s*([a-zA-Z_$]\\w*)\\s*\\)`,
        "g",
      );
      line = line.replace(funcRe, (m, param) => {
        fixes.TS7006++;
        return `.${method}(function(${param}: any)`;
      });
    }

    // Regular function declarations: function name(word) { or async function name(word) {
    // But skip if word already has : type
    line = line.replace(
      /(\b(?:async\s+)?function\s+\w+\s*)\(\s*([a-zA-Z_$]\w*)\s*\)/g,
      (m, prefix, param) => {
        if (param.endsWith("any") || param.endsWith("unknown") || param.includes(":")) return m;
        fixes.TS7006++;
        return `${prefix}(${param}: any)`;
      },
    );

    // Arrow function declarations at top level: const name = (word) => { or const name = (word, w2) => {
    // This is tricky — need to not double-fix. Let's be conservative and only fix the catch/then/.map cases.

    // Object literals that need type annotation
    // const x = {} → const x: Record<string, any> = {}
    // But skip if already typed
    line = line.replace(/\b(const|let|var)\s+(\w+)\s*=\s*\{\s*\}/g, (m, kw, name) => {
      if (m.includes(":")) return m;
      fixes.TS7018++;
      return `${kw} ${name}: Record<string, unknown> = {}`;
    });

    // new Set() → new Set<any>()  (safety: only if not already typed)
    line = line.replace(/new Set\s*\(\s*\)/g, (m) => {
      fixes.TS7034++;
      return "new Set<any>()";
    });
    // new Map() → new Map<any, any>()
    line = line.replace(/new Map\s*\(\s*\)/g, (m) => {
      fixes.TS7034++;
      return "new Map<any, any>()";
    });

    // const x = new Set() → const x: Set<any> = new Set<any>()
    line = line.replace(/\b(const|let|var)\s+(\w+)\s*=\s*new Set/gi, (m, kw, name) => {
      if (!m.includes(":")) {
        fixes.TS7005++;
        return `${kw} ${name}: Set<any> = new Set`;
      }
      return m;
    });
    line = line.replace(/\b(const|let|var)\s+(\w+)\s*=\s*new Map/gi, (m, kw, name) => {
      if (!m.includes(":")) {
        fixes.TS7005++;
        return `${kw} ${name}: Map<any, any> = new Map`;
      }
      return m;
    });

    fixedLines.push(line);
  }

  const result = fixedLines.join("\n");
  if (result !== orig) {
    writeFileSync(file, result, "utf-8");
  }
}

console.log(`Fixes applied:`);
for (const [k, v] of Object.entries(fixes)) {
  if (v > 0) console.log(`  ${k}: ${v}`);
}
const total = Object.values(fixes).reduce((a, b) => a + b, 0);
console.log(`Total: ${total}`);
