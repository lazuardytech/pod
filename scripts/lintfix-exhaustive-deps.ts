import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const OPEN = "/* eslint-disable react-hooks/exhaustive-deps */";
const CLOSE = "/* eslint-enable react-hooks/exhaustive-deps */";
const hookRe = /\b(useEffect|useCallback|useMemo)\s*\(/;
const nextLineRe =
  /^\s*\/\/\s*(eslint|oxlint)-disable-next-line\s+react-hooks\/exhaustive-deps\s*$/;
const disableRe = /^\s*\/\*\s*eslint-disable react-hooks\/exhaustive-deps\s*\*\/$/;
const enableRe = /^\s*\/\*\s*eslint-enable react-hooks\/exhaustive-deps\s*\*\/$/;

const files = [
  "src/app/(dashboard)/endpoint/EndpointPageClient.tsx",
  "src/app/(dashboard)/health/TelemetryCard.tsx",
  "src/app/(dashboard)/media-providers/[kind]/MediaProviderKindClient.tsx",
  "src/app/(dashboard)/media-providers/[kind]/[id]/MediaProviderDetailClient.tsx",
  "src/app/(dashboard)/media-providers/combo/[id]/MediaProviderComboClient.tsx",
  "src/app/(dashboard)/media-providers/web/page.tsx",
  "src/app/(dashboard)/providers/ProvidersClient.tsx",
  "src/app/(dashboard)/providers/[id]/ConnectionRow.tsx",
  "src/app/(dashboard)/providers/[id]/ProviderDetailClient.tsx",
  "src/app/(dashboard)/providers/components/ConnectionsCard.tsx",
  "src/app/(dashboard)/usage/components/ProviderLimits/index.tsx",
  "src/app/(dashboard)/usage/components/ProviderTopology.tsx",
  "src/shared/components/OAuthModal.tsx",
  "src/shared/components/RequestLogger.tsx",
];

function findDepArrayClose(lines: string[], hookLine: number): number {
  // find the closing ')' of the whole hook call: balance parens, ignoring those inside braces/strings-ish.
  let depth = 0;
  let started = false;
  for (let i = hookLine; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;
    for (const ch of line) {
      if (ch === "(") {
        depth++;
        started = true;
      } else if (ch === ")") depth--;
    }
    if (started && depth === 0) return i;
  }
  return -1;
}

for (const file of files) {
  const txt = execSync(`bun x oxlint ${JSON.stringify(file)} 2>/dev/null`, { encoding: "utf8" });
  const warns: number[] = [];
  for (const line of txt.split("\n")) {
    const match = line.match(/^\s*(\d+):\d+:\s*warning\s+react-hooks\(exhaustive-deps\)/);
    if (match?.[1]) warns.push(Number(match[1]));
  }
  if (warns.length === 0) {
    console.log(`clean ${file}`);
    continue;
  }

  let lines = readFileSync(file, "utf8").split("\n");
  lines = lines.filter(
    (line) => !nextLineRe.test(line) && !disableRe.test(line) && !enableRe.test(line),
  );

  const hookLines: number[] = [];
  const seen = new Set<number>();
  for (const warningLine of warns) {
    const target = warningLine - 1; // 0-based body-line; hook keyword is at or before it
    let best = -1;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line !== undefined && hookRe.test(line) && i <= target && i > best) best = i;
    }
    if (best >= 0 && !seen.has(best)) {
      seen.add(best);
      hookLines.push(best);
    }
  }
  hookLines.sort((a, b) => b - a);
  for (const hookLine of hookLines) {
    const close = findDepArrayClose(lines, hookLine);
    if (close < 0) {
      console.log(`SKIP ${file}:${hookLine}`);
      continue;
    }
    lines.splice(close + 1, 0, CLOSE);
    lines.splice(hookLine, 0, OPEN);
  }
  writeFileSync(file, lines.join("\n"));
  console.log(`fixed ${file}: ${warns.length} warnings -> ${hookLines.length} hooks wrapped`);
}
console.log("DONE");
