import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "@/lib/dataDir";
import {
  EXTRA_MARKERS,
  findHeadroomBinary,
  findPython310,
  getInstalledHeadroomExtras,
  HEADROOM_COMPRESSION_EXTRAS,
  type HeadroomCompressionExtra,
} from "./detect.ts";

const HEADROOM_DIR = path.join(DATA_DIR, "headroom");
const PID_FILE = path.join(HEADROOM_DIR, "proxy.pid");
const LOG_FILE = path.join(HEADROOM_DIR, "proxy.log");
const INSTALL_LOG_FILE = path.join(HEADROOM_DIR, "install.log");
const DEFAULT_PORT = 8787;

function childEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: process.env.NODE_ENV,
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    LANG: process.env.LANG,
    LC_ALL: process.env.LC_ALL,
    TERM: process.env.TERM,
    USER: process.env.USER,
    TMPDIR: process.env.TMPDIR,
  };
  if (process.platform === "win32") {
    env.SYSTEMROOT = process.env.SYSTEMROOT;
    env.PATHEXT = process.env.PATHEXT;
    env.USERPROFILE = process.env.USERPROFILE;
  }
  return env;
}
const STARTUP_TIMEOUT_MS = 8000;

type CodedError = Error & { code: string };

function fail(message: string, code: string): never {
  const err = new Error(message) as CodedError;
  err.code = code;
  throw err;
}

function ensureDir(): void {
  if (!fs.existsSync(HEADROOM_DIR)) fs.mkdirSync(HEADROOM_DIR, { recursive: true });
}

function readPid(): number | null {
  try {
    if (fs.existsSync(PID_FILE)) return Number.parseInt(fs.readFileSync(PID_FILE, "utf8"), 10);
  } catch {
    // ignore
  }
  return null;
}

function writePid(pid: number): void {
  ensureDir();
  fs.writeFileSync(PID_FILE, String(pid));
}

function clearPid(): void {
  try {
    if (fs.existsSync(PID_FILE)) fs.unlinkSync(PID_FILE);
  } catch {
    // ignore
  }
}

export function isPidAlive(pid: number | null): boolean {
  if (!pid || typeof pid !== "number") return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function getManagedPid(): number | null {
  const pid = readPid();
  return pid && isPidAlive(pid) ? pid : null;
}

function extrasProxyArgs({
  codeAware,
  kompress,
}: {
  codeAware?: boolean;
  kompress?: boolean;
} = {}): string[] {
  const args: string[] = [];
  if (codeAware) args.push("--code-aware");
  if (kompress === false) args.push("--disable-kompress");
  return args;
}

export async function startHeadroomProxy({
  port = DEFAULT_PORT,
  codeAware = false,
  kompress = true,
}: {
  port?: number;
  codeAware?: boolean;
  kompress?: boolean;
} = {}): Promise<{ pid: number; alreadyRunning: boolean }> {
  const safePort = Number(port) > 0 && Number(port) < 65536 ? Number(port) : DEFAULT_PORT;
  const binary = findHeadroomBinary();
  if (!binary) fail("Headroom CLI not installed", "NOT_INSTALLED");

  const existing = getManagedPid();
  if (existing) return { pid: existing, alreadyRunning: true };

  ensureDir();
  const outFd = fs.openSync(LOG_FILE, "a");
  const args = ["proxy", "--port", String(safePort), ...extrasProxyArgs({ codeAware, kompress })];
  const child = spawn(binary, args, {
    stdio: ["ignore", outFd, outFd],
    detached: true,
    windowsHide: true,
    env: childEnv(),
  });

  if (!child.pid) {
    fs.closeSync(outFd);
    fail("Failed to spawn headroom proxy", "SPAWN_FAILED");
  }
  const pid = child.pid;

  child.unref();
  writePid(pid);

  await new Promise<void>((resolve, reject) => {
    const startupTimer = setTimeout(() => {
      if (isPidAlive(pid)) resolve();
      else reject(new Error("headroom proxy exited during startup — see proxy.log"));
    }, STARTUP_TIMEOUT_MS);

    child.once("exit", (code) => {
      clearTimeout(startupTimer);
      clearPid();
      try {
        fs.closeSync(outFd);
      } catch {
        // already closed
      }
      const e = new Error(
        `headroom proxy exited early (code=${code}) — see proxy.log`,
      ) as CodedError;
      e.code = "EARLY_EXIT";
      reject(e);
    });
  });

  try {
    fs.closeSync(outFd);
  } catch {
    // child retains the fd
  }

  return { pid, alreadyRunning: false };
}

export function stopHeadroomProxy(): { stopped: boolean; pid?: number; reason?: string } {
  const pid = getManagedPid();
  if (!pid) return { stopped: false, reason: "not_running" };
  try {
    process.kill(pid, "SIGTERM");
    setTimeout(() => {
      if (isPidAlive(pid)) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          // already gone
        }
      }
    }, 2000);
    clearPid();
    return { stopped: true, pid };
  } catch (e) {
    clearPid();
    fail(
      `Failed to stop headroom proxy: ${e instanceof Error ? e.message : "unknown"}`,
      "STOP_FAILED",
    );
  }
}

export async function restartHeadroomProxy(
  opts: {
    port?: number;
    codeAware?: boolean;
    kompress?: boolean;
  } = {},
): Promise<{ pid: number; alreadyRunning: boolean }> {
  const pid = getManagedPid();
  if (pid) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // already gone
    }
    for (let i = 0; i < 30 && isPidAlive(pid); i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
    if (isPidAlive(pid)) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // already gone
      }
      await new Promise((r) => setTimeout(r, 300));
    }
    clearPid();
  }
  return startHeadroomProxy(opts);
}

export function getHeadroomLogTail(maxLines = 200): string {
  try {
    if (!fs.existsSync(LOG_FILE)) return "";
    const lines = fs.readFileSync(LOG_FILE, "utf8").split(/\r?\n/).filter(Boolean);
    return lines.slice(-maxLines).join("\n");
  } catch {
    return "";
  }
}

export async function installHeadroomExtras(extras: unknown[] = []) {
  const requested = (Array.isArray(extras) ? extras : []).filter(
    (e): e is HeadroomCompressionExtra =>
      typeof e === "string" && (HEADROOM_COMPRESSION_EXTRAS as readonly string[]).includes(e),
  );
  const py = findPython310();
  if (!py) fail("Python >= 3.10 not found", "NO_PYTHON");
  if (!findHeadroomBinary()) {
    fail("headroom-ai not installed (run `pip install headroom-ai[proxy]` first)", "NOT_INSTALLED");
  }
  const extrasList = ["proxy", ...requested].join(",");
  const spec = `headroom-ai[${extrasList}]`;
  const args = ["-m", "pip", "install", "--upgrade", spec];

  ensureDir();
  const outFd = fs.openSync(INSTALL_LOG_FILE, "w");
  const child = spawn(py, args, {
    stdio: ["ignore", outFd, outFd],
    windowsHide: true,
    env: childEnv(),
  });

  return new Promise((resolve, reject) => {
    child.once("error", (e) => {
      fs.closeSync(outFd);
      reject(e);
    });
    child.once("exit", (code) => {
      fs.closeSync(outFd);
      if (code === 0) {
        resolve({
          success: true,
          code,
          spec,
          requested,
          ...getInstalledHeadroomExtras(py),
        });
      } else {
        const err = new Error(
          `pip install exited with code=${code} — see headroom/install.log`,
        ) as CodedError;
        err.code = "INSTALL_FAILED";
        reject(err);
      }
    });
  });
}

export async function uninstallHeadroomExtras(extras: unknown[] = []) {
  const requested = (Array.isArray(extras) ? extras : []).filter(
    (e): e is HeadroomCompressionExtra =>
      typeof e === "string" && (HEADROOM_COMPRESSION_EXTRAS as readonly string[]).includes(e),
  );
  const py = findPython310();
  if (!py) fail("Python >= 3.10 not found", "NO_PYTHON");
  const pkgs = [...new Set(requested.flatMap((e) => EXTRA_MARKERS[e] || []))];
  if (pkgs.length === 0) fail("No valid extras to remove", "INVALID_EXTRAS");
  const args = ["-m", "pip", "uninstall", "-y", ...pkgs];

  ensureDir();
  const outFd = fs.openSync(INSTALL_LOG_FILE, "w");
  const child = spawn(py, args, {
    stdio: ["ignore", outFd, outFd],
    windowsHide: true,
    env: childEnv(),
  });

  return new Promise((resolve, reject) => {
    child.once("error", (e) => {
      fs.closeSync(outFd);
      reject(e);
    });
    child.once("exit", (code) => {
      fs.closeSync(outFd);
      if (code === 0) {
        resolve({
          success: true,
          code,
          removed: pkgs,
          requested,
          ...getInstalledHeadroomExtras(py),
        });
      } else {
        const err = new Error(
          `pip uninstall exited with code=${code} — see headroom/install.log`,
        ) as CodedError;
        err.code = "UNINSTALL_FAILED";
        reject(err);
      }
    });
  });
}

export function getInstallLogTail(maxLines = 15): string {
  try {
    if (!fs.existsSync(INSTALL_LOG_FILE)) return "";
    const lines = fs.readFileSync(INSTALL_LOG_FILE, "utf8").split(/\r?\n/).filter(Boolean);
    return lines.slice(-maxLines).join("\n");
  } catch {
    return "";
  }
}
