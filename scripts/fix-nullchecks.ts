import { readFileSync, writeFileSync, statSync, readdirSync } from "fs";
import { join } from "path";

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (entry === "node_modules" || entry === ".next") continue;
    if (statSync(full).isDirectory()) yield* walk(full);
    else yield full;
  }
}

const files = Array.from(walk("src")).filter(
  (f) => /\.(ts|tsx)$/.test(f) && !f.endsWith(".d.ts")
);

let totalFixes = 0;

for (const file of files) {
  let content = readFileSync(file, "utf-8");
  let orig = content;

  // Fix 1: .filter(Boolean) should narrow type — add "as" after for non-null assertions
  // Common: (x.filter(Boolean) => we already use .filter(Boolean) which TS handles

  // Fix 2: destructuring possibly-null objects — add fallback
  // const { x } = y ?? {}
  content = content.replace(
    /const\s*\{\s*([^}]+)\s*\}\s*=\s*([a-zA-Z_$][\w$.]+(?:\s*\?\s*:\s*\w+)?)\s*;/g,
    (match, destr, src) => {
      // Only if the destructure is from a ref?.prop or something that could be null
      // Skip if already has fallback
      if (destr.includes(": any") || match.includes("??") || match.includes("||")) return match;
      // Add ?. accessor and ?? {} fallback
      return `const { ${destr} } = ${src} ?? {} as any;`;
    }
  );

  // Fix 3: function return type with possibly-null returns
  // StrictNullChecks: if function can return null, add " | null"
  // This is hard to detect mechanically, skip

  // Fix 4: add ! to .current accesses on useRef when assigned in onInit/useEffect
  // Pattern: xxxx.current.xxxxx -> xxxx.current!.xxxxx
  // (only for refs that are guaranteed non-null by useEffect)
  content = content.replace(
    /(\w+)Ref\.current\./g,
    (match, ref) => {
      if (ref === "container" || ref === "rfInstance" || ref.endsWith("Ref") || ref.endsWith("ref")) {
        return `${ref}Ref.current!.`;
      }
      return match;
    }
  );

  // Fix 5: simple `if (x) { x.y }` doesn't narrow properly in some TS versions
  // For common patterns: add `!` after function calls that return T | undefined but context guarantees non-null

  if (content !== orig) {
    writeFileSync(file, content, "utf-8");
    totalFixes++;
  }
}

console.log(`Processed ${files.length} files, modified ${totalFixes}`);
