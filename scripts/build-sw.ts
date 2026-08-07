import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const sourceFile = "src/sw/sw.ts";
const outputFile = "public/sw.js";
const generatedHeader = `// Generated from ${sourceFile} by scripts/build-sw.ts; do not edit.`;

const source = await readFile(sourceFile, "utf8");
const transpiler = new Bun.Transpiler({ loader: "ts", target: "browser" });
const compiled = transpiler
  .transformSync(source)
  .replace(/^\/\/\/ <reference .*$/gm, "")
  .trimStart();

await mkdir(dirname(outputFile), { recursive: true });
await writeFile(outputFile, `${generatedHeader}\n${compiled}`);
execFileSync("bun", ["x", "oxfmt", "--write", outputFile], { stdio: "ignore" });

console.log(`[build-sw] wrote ${outputFile} from ${sourceFile}`);
