import { readFileSync, writeFileSync } from "fs";
import { readdirSync, statSync } from "fs";
import { join, extname } from "path";

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      yield* walk(full);
    } else {
      yield full;
    }
  }
}

const files = Array.from(walk("src")).filter((f) => /\.(ts|tsx)$/.test(f) && !f.endsWith(".d.ts"));

let totalFixes = 0;

for (const file of files) {
  let content = readFileSync(file, "utf-8");

  // Fix TS7034: new Set() without type args
  content = content.replace(/new Set\s*\(\s*\)/g, () => {
    totalFixes++;
    return "new Set<any>()";
  });
  // Fix new Map() without type args
  content = content.replace(/new Map\s*\(\s*\)/g, () => {
    totalFixes++;
    return "new Map<any, any>()";
  });

  writeFileSync(file, content, "utf-8");
}

console.log(`${totalFixes} fixes applied to ${files.length} files`);
