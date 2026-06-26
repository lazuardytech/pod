import { NextResponse } from "next/server";

import { sanitizeError } from "@/lib/sanitizeError";
const EXTENDED_PATH = "/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin";

function getDataDir() {
  if (process.env.DATA_DIR) return process.env.DATA_DIR;
  if (process.platform === "win32") {
    return `${process.env.APPDATA || `${process.env.USERPROFILE || "C:\\"}\\AppData\\Roaming`}\\pod`;
  }
  return `${process.env.HOME || "/tmp"}/.pod`;
}

const DATA_DIR = getDataDir();

function runCommandSync(spawnSync, command, args, { timeout = 5000, env } = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    windowsHide: true,
    timeout,
    env,
  });
  if (result.error || result.status !== 0) return null;
  return typeof result.stdout === "string" ? result.stdout : "";
}

function getTailscaleBin(spawnSync) {
  const lookupCommand = process.platform === "win32" ? "where" : "which";
  const systemPath = runCommandSync(spawnSync, lookupCommand, ["tailscale"], {
    timeout: 3000,
    env: { ...process.env, PATH: EXTENDED_PATH },
  })?.trim();
  return systemPath || null;
}

function isTailscaleInstalled(spawnSync) {
  return getTailscaleBin(spawnSync) !== null;
}

function runTailscaleJson(spawnSync, args, { timeout = 5000 } = {}) {
  const bin = getTailscaleBin(spawnSync);
  if (!bin) return null;
  const out = runCommandSync(
    spawnSync,
    bin,
    [
      process.platform === "win32" ? null : "--socket",
      process.platform === "win32" ? null : `${DATA_DIR}/tailscale/tailscaled.sock`,
      ...args,
    ].filter(Boolean),
    {
      timeout,
      env: { ...process.env, PATH: EXTENDED_PATH },
    },
  );
  if (!out) return null;
  try {
    return JSON.parse(out);
  } catch {
    return null;
  }
}

function isTailscaleLoggedIn(spawnSync) {
  const json = runTailscaleJson(spawnSync, ["status", "--json"], { timeout: 5000 });
  return json?.BackendState === "Running";
}

function hasBrew(execSync) {
  try {
    execSync("which brew", { stdio: "ignore", windowsHide: true, env: { ...process.env, PATH: EXTENDED_PATH } });
    return true;
  } catch {
    return false;
  }
}

function isDaemonRunning(spawnSync, execSync) {
  const bin = getTailscaleBin(spawnSync);
  if (!bin) return false;
  try {
    const result = spawnSync(
      bin,
      [
        process.platform === "win32" ? null : "--socket",
        process.platform === "win32" ? null : `${DATA_DIR}/tailscale/tailscaled.sock`,
        "status",
        "--json",
      ].filter(Boolean),
      {
        encoding: "utf8",
        stdio: "ignore",
        windowsHide: true,
        env: { ...process.env, PATH: EXTENDED_PATH },
        timeout: 3000,
      },
    );
    if (!result.error && result.status === 0) {
      return true;
    }
    if (process.platform === "win32") {
      const tasklist = runCommandSync(spawnSync, "tasklist", ["/FI", "IMAGENAME eq tailscaled.exe"], { timeout: 2000 });
      return tasklist?.toLowerCase().includes("tailscaled.exe") ?? false;
    }
    execSync("pgrep -x tailscaled", {
      stdio: "ignore",
      windowsHide: true,
      env: { ...process.env, PATH: EXTENDED_PATH },
      timeout: 2000,
    });
    if (process.platform !== "win32") {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export async function GET() {
  try {
    const { execSync, spawnSync } = await import("node:child_process");
    const installed = isTailscaleInstalled(spawnSync);
    const platform = process.platform;
    const brewAvailable = platform === "darwin" && hasBrew(execSync);
    const daemonRunning = installed ? isDaemonRunning(spawnSync, execSync) : false;
    const loggedIn = daemonRunning ? isTailscaleLoggedIn(spawnSync) : false;
    return NextResponse.json({ installed, loggedIn, platform, brewAvailable, daemonRunning });
  } catch (error) {
    return NextResponse.json({ error: sanitizeError(error) }, { status: 500 });
  }
}
