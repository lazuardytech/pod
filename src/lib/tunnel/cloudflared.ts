import { execSync, spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import type { IncomingMessage } from "node:http";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { DATA_DIR } from "@/lib/dataDir";
import { resetDownloadState, setDownloadState } from "./downloadState.ts";
import { clearPid, loadPid, savePid } from "./state.ts";

const BIN_DIR = path.join(/*turbopackIgnore: true*/ DATA_DIR, "bin");
const BINARY_NAME = "cloudflared";
const IS_WINDOWS = os.platform() === "win32";
const BIN_NAME = IS_WINDOWS ? `${BINARY_NAME}.exe` : BINARY_NAME;
const BIN_PATH = path.join(/*turbopackIgnore: true*/ BIN_DIR, BIN_NAME);
const POWERSHELL_HIDDEN_COMMAND = "powershell -NoProfile -NonInteractive -WindowStyle Hidden -Command";

const GITHUB_BASE_URL = "https://github.com/cloudflare/cloudflared/releases/latest/download";

const PLATFORM_MAPPINGS: Record<string, Record<string, string>> = {
  darwin: {
    x64: "cloudflared-darwin-amd64.tgz",
    arm64: "cloudflared-darwin-arm64.tgz",
  },
  win32: {
    x64: "cloudflared-windows-amd64.exe",
    ia32: "cloudflared-windows-386.exe",
    arm64: "cloudflared-windows-386.exe",
  },
  linux: {
    x64: "cloudflared-linux-amd64",
    arm64: "cloudflared-linux-arm64",
  },
};

// Fallback order: prefer smallest/most-compatible binary per platform
const PLATFORM_FALLBACK: Record<string, string> = {
  darwin: "cloudflared-darwin-amd64.tgz",
  win32: "cloudflared-windows-386.exe",
  linux: "cloudflared-linux-amd64",
};

function getDownloadUrl(): string {
  const platform = os.platform();
  const arch = os.arch();

  const platformMapping = PLATFORM_MAPPINGS[platform];
  if (!platformMapping) {
    throw new Error(`Unsupported platform: ${platform}`);
  }

  const binaryName = platformMapping[arch] || PLATFORM_FALLBACK[platform];
  return `${GITHUB_BASE_URL}/${binaryName}`;
}

function downloadFile(url: string, dest: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(/*turbopackIgnore: true*/ dest);

    https
      .get(url, (response: IncomingMessage) => {
        if (response.statusCode && [301, 302, 303, 307, 308].includes(response.statusCode)) {
          file.close();
          fs.unlinkSync(/*turbopackIgnore: true*/ dest);
          downloadFile(response.headers.location!, dest).then(resolve).catch(reject);
          return;
        }

        if (response.statusCode !== 200) {
          file.close();
          fs.unlinkSync(/*turbopackIgnore: true*/ dest);
          reject(new Error(`Download failed with status ${response.statusCode}`));
          return;
        }

        const totalBytes = parseInt(response.headers["content-length"]!, 10) || 0;
        let receivedBytes = 0;
        setDownloadState({ downloading: true, progress: 0 });

        response.on("data", (chunk: Buffer) => {
          receivedBytes += chunk.length;
          if (totalBytes > 0) {
            setDownloadState({ progress: Math.round((receivedBytes / totalBytes) * 100) });
          }
        });

        response.pipe(file);

        file.on("finish", () => {
          setDownloadState({ downloading: false, progress: 100 });
          file.close(() => resolve(dest));
        });

        file.on("error", (err) => {
          resetDownloadState();
          file.close();
          fs.unlinkSync(/*turbopackIgnore: true*/ dest);
          reject(err);
        });
      })
      .on("error", (err) => {
        resetDownloadState();
        file.close();
        if (fs.existsSync(/*turbopackIgnore: true*/ dest)) fs.unlinkSync(/*turbopackIgnore: true*/ dest);
        reject(err);
      });
  });
}

const MIN_BINARY_SIZE = 1024 * 1024; // 1MB - cloudflared is ~30MB+

// Validate binary is executable on current platform and not truncated
function isValidBinary(filePath: string): boolean {
  try {
    const stat = fs.statSync(/*turbopackIgnore: true*/ filePath);
    if (stat.size < MIN_BINARY_SIZE) return false;
    const fd = fs.openSync(/*turbopackIgnore: true*/ filePath, "r");
    const buf = Buffer.alloc(4);
    fs.readSync(fd, buf, 0, 4, 0);
    fs.closeSync(fd);
    const magic = buf.toString("hex");
    if (IS_WINDOWS) return magic.startsWith("4d5a"); // PE (MZ)
    if (os.platform() === "darwin") return magic.startsWith("cffaedfe") || magic.startsWith("cefaedfe");
    return magic.startsWith("7f454c46"); // ELF (Linux)
  } catch {
    return false;
  }
}

let downloadPromise: Promise<string> | null = null;

export async function ensureCloudflared(): Promise<string> {
  if (downloadPromise) return downloadPromise;
  downloadPromise = _ensureCloudflared().finally(() => {
    downloadPromise = null;
  });
  return downloadPromise;
}

async function _ensureCloudflared(): Promise<string> {
  resetDownloadState();

  if (!fs.existsSync(/*turbopackIgnore: true*/ BIN_DIR)) {
    fs.mkdirSync(/*turbopackIgnore: true*/ BIN_DIR, { recursive: true });
  }

  // Clean up incomplete downloads from previous runs
  const tmpPath = `${BIN_PATH}.tmp`;
  if (fs.existsSync(/*turbopackIgnore: true*/ tmpPath)) {
    try {
      fs.unlinkSync(/*turbopackIgnore: true*/ tmpPath);
    } catch {
      /* ignore */
    }
  }

  if (fs.existsSync(/*turbopackIgnore: true*/ BIN_PATH)) {
    if (!isValidBinary(BIN_PATH)) {
      console.log("[cloudflared] Invalid binary detected, re-downloading...");
      fs.unlinkSync(/*turbopackIgnore: true*/ BIN_PATH);
    } else {
      if (!IS_WINDOWS) fs.chmodSync(/*turbopackIgnore: true*/ BIN_PATH, "755");
      return BIN_PATH;
    }
  }

  const url = getDownloadUrl();
  const isArchive = url.endsWith(".tgz");
  const downloadDest = isArchive ? path.join(/*turbopackIgnore: true*/ BIN_DIR, "cloudflared.tgz.tmp") : tmpPath;

  await downloadFile(url, downloadDest);

  if (isArchive) {
    execSync(`tar -xzf "${downloadDest}" -C "${BIN_DIR}"`, { stdio: "pipe", windowsHide: true });
    fs.unlinkSync(/*turbopackIgnore: true*/ downloadDest);
  } else {
    fs.renameSync(/*turbopackIgnore: true*/ downloadDest, /*turbopackIgnore: true*/ BIN_PATH);
  }

  if (!IS_WINDOWS) {
    fs.chmodSync(/*turbopackIgnore: true*/ BIN_PATH, "755");
  }

  return BIN_PATH;
}

let cloudflaredProcess: ChildProcess | null = null;
let unexpectedExitHandler: (() => void) | null = null;
let spawnLock: Promise<void> | null = null;

function killExistingProcess() {
  if (cloudflaredProcess) {
    try {
      cloudflaredProcess.kill("SIGTERM");
      const old = cloudflaredProcess;
      // Wait up to 5s for graceful exit, then SIGKILL
      setTimeout(() => {
        try {
          old.kill("SIGKILL");
        } catch {}
      }, 5000).unref();
    } catch {}
    cloudflaredProcess = null;
  }
}

/** Register a callback to be called when cloudflared exits unexpectedly after connecting */
export function setUnexpectedExitHandler(handler: (() => void) | null) {
  unexpectedExitHandler = handler;
}

export async function spawnCloudflared(tunnelToken: string): Promise<ChildProcess> {
  // Serialize spawns to prevent orphaned processes on concurrent calls
  while (spawnLock) await spawnLock;
  let unlock!: () => void;
  spawnLock = new Promise<void>((r) => {
    unlock = r;
  });

  try {
    killExistingProcess();
    const binaryPath = await ensureCloudflared();

    const child = spawn(binaryPath, ["tunnel", "run", "--dns-resolver-addrs", "1.1.1.1:53", "--token", tunnelToken], {
      detached: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    cloudflaredProcess = child;
    savePid(child.pid!);

    return new Promise<ChildProcess>((resolve, reject) => {
      let connectionCount = 0;
      let resolved = false;
      const timeout = setTimeout(() => {
        resolved = true;
        resolve(child);
      }, 90000);

      const handleLog = (data: Buffer) => {
        const msg = data.toString();
        // Count exact occurrences in this chunk (each chunk may contain multiple lines)
        const matches = msg.match(/Registered tunnel connection/g);
        if (matches) {
          connectionCount += matches.length;
          if (connectionCount >= 4 && !resolved) {
            resolved = true;
            clearTimeout(timeout);
            resolve(child);
          }
        }
      };

      child.stdout!.on("data", handleLog);
      child.stderr!.on("data", handleLog);

      child.on("error", (err) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          reject(err);
        }
      });

      child.on("exit", (code, signal) => {
        cloudflaredProcess = null;
        clearPid();
        const wasConnected = resolved; // true = already connected successfully
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          // Collect stderr output for better error diagnosis
          const stderrOutput = " Check cloudflared logs for details.";
          if (code === 1) {
            // Common exit code 1 issues: invalid token, auth failure, network issues
            reject(
              new Error(
                `cloudflared exited with code ${code}${stderrOutput} Ensure your tunnel token is valid and network is reachable.`,
              ),
            );
          } else if (code === 2) {
            reject(
              new Error(`cloudflared exited with code ${code}${stderrOutput} Check if required arguments are correct.`),
            );
          } else {
            reject(new Error(`cloudflared exited with code ${code}${stderrOutput}`));
          }
          return;
        }
        // Watchdog (initializeApp) handles recovery — no auto-reconnect here
        if (wasConnected && unexpectedExitHandler) unexpectedExitHandler();
      });
    }).finally(() => {
      spawnLock = null;
      unlock?.();
    });
  } catch (e) {
    spawnLock = null;
    unlock?.();
    throw e;
  }
}

export interface QuickTunnelResult {
  child: ChildProcess;
  tunnelUrl: string;
}

/**
 * Spawn cloudflared quick tunnel (no account needed)
 * Returns the generated trycloudflare.com URL
 */
export async function spawnQuickTunnel(
  localPort: number,
  onUrlUpdate?: (url: string) => void,
): Promise<QuickTunnelResult> {
  const binaryPath = await ensureCloudflared();

  const configDir = fs.mkdtempSync(path.join(/*turbopackIgnore: true*/ os.tmpdir(), "cloudflared-quick-"));
  const configPath = path.join(/*turbopackIgnore: true*/ configDir, "config.yml");
  // Avoid using default ~/.cloudflared/config.yml, which can conflict with quick tunnel behavior.
  fs.writeFileSync(/*turbopackIgnore: true*/ configPath, "# quick-tunnel config placeholder\n", "utf8");

  let isCleaned = false;
  const cleanup = () => {
    if (isCleaned) return;
    isCleaned = true;
    try {
      fs.rmSync(/*turbopackIgnore: true*/ configDir, { recursive: true, force: true });
    } catch (_e) {
      /* ignore */
    }
  };

  const child = spawn(
    binaryPath,
    ["tunnel", "--url", `http://localhost:${localPort}`, "--config", configPath, "--no-autoupdate"],
    {
      detached: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  cloudflaredProcess = child;
  savePid(child.pid!);

  return new Promise((resolve, reject) => {
    let resolved = false;

    function getQuickTunnelUrlFromLog(message: string): string | null {
      // cloudflared logs may contain "api.trycloudflare.com" as well,
      // but that is NOT the quick-tunnel endpoint we need.
      const regex = /https:\/\/([a-z0-9-]+)\.trycloudflare\.com/gi;
      const candidates: string[] = [];

      for (const match of message.matchAll(regex)) {
        const host = match[1];
        if (host === "api") continue;
        candidates.push(`https://${host}.trycloudflare.com`);
      }

      if (!candidates.length) return null;
      return candidates[candidates.length - 1]!;
    }

    const timeout = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      cleanup();
      reject(new Error("Quick tunnel timed out"));
    }, 90000);

    let lastUrl: string | null = null;

    const handleLog = (data: Buffer) => {
      const msg = data.toString();
      const tunnelUrl = getQuickTunnelUrlFromLog(msg);
      if (!tunnelUrl) return;

      if (!resolved) {
        // First URL — resolve the promise, do NOT call onUrlUpdate (caller handles initial register)
        resolved = true;
        lastUrl = tunnelUrl;
        clearTimeout(timeout);
        cleanup();
        resolve({ child, tunnelUrl });
        return;
      }

      // URL changed after initial connect — notify caller to re-register
      if (tunnelUrl !== lastUrl) {
        lastUrl = tunnelUrl;
        if (onUrlUpdate) onUrlUpdate(tunnelUrl);
      }
    };

    child.stdout!.on("data", handleLog);
    child.stderr!.on("data", handleLog);

    child.on("error", (err) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      cleanup();
      reject(err);
    });

    child.on("exit", (code, signal) => {
      cloudflaredProcess = null;
      clearPid();
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        cleanup();
        // Provide more helpful error messages for common exit codes
        if (code === 1) {
          reject(
            new Error(
              `cloudflared exited with code ${code}. This often means: (1) the tunnel token is invalid or expired, (2) network connectivity issues, or (3) cloudflared cannot reach the local server.`,
            ),
          );
        } else if (code === 2) {
          reject(new Error(`cloudflared exited with code ${code}. Check that arguments are correct.`));
        } else {
          reject(new Error(`cloudflared exited with code ${code}`));
        }
        return;
      }
      if (unexpectedExitHandler) unexpectedExitHandler();
      cleanup();
    });
  });
}

// Kill cloudflared processes whose command line targets the given port (any host).
// Boundary check ensures :20128 doesn't match :201280 or :202128.
function killCloudflaredByPort(port: number) {
  if (!port) return;
  try {
    if (IS_WINDOWS) {
      const psCmd = `Get-CimInstance Win32_Process -Filter \\"Name='cloudflared.exe'\\" | Where-Object { $_.CommandLine -match ':${port}(\\D|$)' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`;
      execSync(`${POWERSHELL_HIDDEN_COMMAND} "${psCmd}"`, { stdio: "ignore", windowsHide: true });
    } else {
      execSync(`pkill -f "cloudflared.*:${port}([^0-9]|$)"`, { stdio: "ignore", windowsHide: true });
    }
  } catch (_e) {
    /* ignore */
  }
}

export function killCloudflared(localPort?: number) {
  if (cloudflaredProcess) {
    try {
      cloudflaredProcess.kill();
    } catch (_e) {
      /* ignore */
    }
    cloudflaredProcess = null;
  }

  const pid = loadPid();
  if (pid) {
    try {
      process.kill(pid);
    } catch (_e) {
      /* ignore */
    }
    clearPid();
  }

  if (localPort) killCloudflaredByPort(localPort);
}

export function isCloudflaredRunning(): boolean {
  const pid = loadPid();
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (_e) {
    return false;
  }
}
