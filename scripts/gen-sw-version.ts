import { existsSync, readFileSync, writeFileSync } from "node:fs";

function readBuildId(): string {
  try {
    if (existsSync(".next/BUILD_ID")) {
      const id = readFileSync(".next/BUILD_ID", "utf8").trim();
      if (id) return id;
    }
  } catch {
    return "";
  }
  return "";
}

function generateId(): string {
  return Math.random().toString(36).slice(2, 12);
}

const buildId = readBuildId() || generateId();
writeFileSync("public/sw-version.json", `${JSON.stringify({ version: buildId })}\n`);
console.log(`[gen-sw-version] wrote public/sw-version.json version=${buildId}`);
