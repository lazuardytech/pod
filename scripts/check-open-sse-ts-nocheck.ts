import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = join(import.meta.dir, "..");
const openSse = join(root, "open-sse");
const allowPath = join(import.meta.dir, "open-sse-ts-nocheck-allowlist.txt");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith(".ts")) out.push(p);
  }
  return out;
}

const allow = new Set(
  readFileSync(allowPath, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#")),
);

const extra: string[] = [];
for (const file of walk(openSse)) {
  if (!readFileSync(file, "utf8").includes("@ts-nocheck")) continue;
  const rel = relative(root, file).replaceAll("\\", "/");
  if (!allow.has(rel)) extra.push(rel);
}

if (extra.length > 0) {
  console.error("New @ts-nocheck under open-sse/ (not allowlisted):");
  for (const file of extra.sort()) console.error(`  ${file}`);
  process.exit(1);
}
