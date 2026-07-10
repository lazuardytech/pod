import { execSync, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DATA_DIR } from "@/lib/dataDir";

const BIN_DIR = path.join(/*turbopackIgnore: true*/ DATA_DIR, "bin");
const IS_MAC = os.platform() === "darwin";
const _IS_LINUX = os.platform() === "linux";
const IS_WINDOWS = os.platform() === "win32";
const TAILSCALE_BIN = path.join(
  /*turbopackIgnore: true*/ BIN_DIR,
  IS_WINDOWS ? "tailscale.exe" : "tailscale",
);

// Custom socket for userspace-networking mode (no root required)
const TAILSCALE_DIR = path.join(/*turbopackIgnore: true*/ DATA_DIR, "tailscale");
export const TAILSCALE_SOCKET = path.join(
  /*turbopackIgnore: true*/ TAILSCALE_DIR,
  "tailscaled.sock",
);
const SOCKET_FLAG: string[] = IS_WINDOWS ? [] : ["--socket", TAILSCALE_SOCKET];
const EXTENDED_PATH = `/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:${process.env.PATH || ""}`;

// Well-known Windows install path
const WINDOWS_TAILSCALE_BIN = "C:\\Program Files\\Tailscale\\tailscale.exe";
const SUDO_PASSWORD_ERROR_RE = /(incorrect password|sorry, try again|a password is required)/i;

interface SpawnSyncOptions {
  timeout?: number;
  env?: NodeJS.ProcessEnv;
}

function runCommandSync(
  command: string,
  args: string[],
  { timeout = 5000, env }: SpawnSyncOptions = {},
): string | null {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    windowsHide: true,
    timeout,
    env,
  });
  if (result.error || result.status !== 0) return null;
  return typeof result.stdout === "string" ? result.stdout : "";
}

function runTailscaleJson(
  args: string[],
  { timeout = 5000 }: { timeout?: number } = {},
): Record<string, unknown> | null {
  const bin = getTailscaleBin();
  if (!bin) return null;
  const out = runCommandSync(bin, tsArgs(...args), {
    timeout,
    env: { ...process.env, PATH: EXTENDED_PATH },
  });
  if (!out) return null;
  try {
    return JSON.parse(out) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// ponytail: cache `which tailscale` result — avoids 3s spawnSync on every request
// when tailscale is not installed (e.g. Zeabur containers)
let _cachedBin: string | null | undefined;

// Prefer system tailscale, fallback to local bin, then Windows default path
function getTailscaleBin(): string | null {
  if (_cachedBin !== undefined) return _cachedBin;
  try {
    const lookupCommand = IS_WINDOWS ? "where" : "which";
    const lookupArg = "tailscale";
    const systemPath = runCommandSync(lookupCommand, [lookupArg], {
      timeout: 3000,
      env: { ...process.env, PATH: EXTENDED_PATH },
    })?.trim();
    if (systemPath) {
      _cachedBin = systemPath;
      return _cachedBin;
    }
  } catch (_e) {
    /* not in PATH */
  }
  if (fs.existsSync(/*turbopackIgnore: true*/ TAILSCALE_BIN)) {
    _cachedBin = TAILSCALE_BIN;
    return _cachedBin;
  }
  if (IS_WINDOWS && fs.existsSync(/*turbopackIgnore: true*/ WINDOWS_TAILSCALE_BIN)) {
    _cachedBin = WINDOWS_TAILSCALE_BIN;
    return _cachedBin;
  }
  _cachedBin = null;
  return null;
}

export function isTailscaleInstalled(): boolean {
  return getTailscaleBin() !== null;
}

/** Build tailscale CLI args with custom socket (no root needed) */
function tsArgs(...args: string[]): string[] {
  return [...SOCKET_FLAG, ...args];
}

export function isTailscaleLoggedIn(): boolean {
  const json = runTailscaleJson(["status", "--json"], { timeout: 5000 });
  if (!json) return false;
  // BackendState "Running" means fully logged in and connected
  return json.BackendState === "Running";
}

export function isTailscaleRunning(): boolean {
  const json = runTailscaleJson(["funnel", "status", "--json"], { timeout: 5000 });
  if (!json) return false;
  const allowFunnel = json.AllowFunnel as Record<string, unknown> | undefined;
  return Object.keys(allowFunnel || {}).length > 0;
}

/** Get funnel URL from tailscale status */
export function getTailscaleFunnelUrl(_port: number): string | null {
  const json = runTailscaleJson(["status", "--json"], { timeout: 5000 });
  if (!json) return null;
  const self = json.Self as { DNSName?: string } | undefined;
  const dnsName = self?.DNSName?.replace(/\.$/, "");
  if (dnsName) return `https://${dnsName}`;
  return null;
}

/**
 * Install tailscale.
 * - macOS + brew: brew install tailscale (no sudo needed)
 * - macOS no brew: download .pkg then sudo installer -pkg
 * - Linux: fetch install.sh, pipe to sudo -S sh via stdin
 * - Windows: download MSI via UAC-elevated PowerShell
 */
export async function installTailscale(
  sudoPassword: string,
  hostname: string,
  onProgress?: (msg: string) => void,
): Promise<LoginResult> {
  const log = onProgress || (() => {});
  if (IS_WINDOWS) {
    await installTailscaleWindows(log);
    return { alreadyLoggedIn: true };
  }
  if (IS_MAC) await installTailscaleMac(sudoPassword, log);
  else await installTailscaleLinux(sudoPassword, log);

  log("Starting daemon...");
  await startDaemonWithPassword(sudoPassword);
  log("Logging in...");
  return startLogin(hostname);
}

function hasBrew(): boolean {
  try {
    execSync("which brew", {
      stdio: "ignore",
      windowsHide: true,
      env: { ...process.env, PATH: EXTENDED_PATH },
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Run a shell command through sudo.
 * - If `sudoPassword` provided, pass it via stdin (`sudo -S`).
 * - If not provided, require passwordless sudo (`sudo -n`), fail fast otherwise.
 */
function execWithPassword(command: string, sudoPassword: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (IS_WINDOWS) {
      resolve();
      return;
    }

    const hasPassword = typeof sudoPassword === "string" && sudoPassword.length > 0;
    const args = hasPassword ? ["-S", "sh", "-c", command] : ["-n", "sh", "-c", command];
    const child = spawn("sudo", args, {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      env: { ...process.env, PATH: EXTENDED_PATH },
    });

    let stderr = "";
    let stdout = "";

    child.stdout.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    child.on("error", reject);

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      const message = stderr.trim() || stdout.trim() || `sudo command failed (code ${code})`;
      if (SUDO_PASSWORD_ERROR_RE.test(message)) {
        reject(new Error("Wrong sudo password"));
        return;
      }
      reject(new Error(message));
    });

    if (hasPassword) {
      child.stdin!.write(`${sudoPassword}\n`);
    }
    child.stdin!.end();
  });
}

async function installTailscaleMac(sudoPassword: string, log: (msg: string) => void) {
  if (hasBrew()) {
    log("Installing via Homebrew...");
    await new Promise<void>((resolve, reject) => {
      const child = spawn("brew", ["install", "tailscale"], {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        env: { ...process.env, PATH: EXTENDED_PATH },
      });
      child.stdout.on("data", (d: Buffer) => {
        const line = d.toString().trim();
        if (line) log(line);
      });
      child.stderr.on("data", (d: Buffer) => {
        const line = d.toString().trim();
        if (line) log(line);
      });
      child.on("close", (c) => {
        if (c === 0) resolve();
        else reject(new Error(`brew install failed (code ${c})`));
      });
      child.on("error", reject);
    });
    return;
  }

  // No brew: download .pkg and install via sudo installer
  const pkgUrl = "https://pkgs.tailscale.com/stable/tailscale-latest.pkg";
  const pkgPath = path.join(/*turbopackIgnore: true*/ os.tmpdir(), "tailscale.pkg");

  log("Downloading Tailscale package...");
  await new Promise<void>((resolve, reject) => {
    const child = spawn("curl", ["-fL", "--progress-bar", pkgUrl, "-o", pkgPath], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    child.stderr.on("data", (d: Buffer) => {
      const line = d.toString().trim();
      if (line) log(line);
    });
    child.on("close", (c) => {
      if (c === 0) resolve();
      else reject(new Error("Download failed"));
    });
    child.on("error", reject);
  });

  log("Installing package...");
  await new Promise<void>((resolve, reject) => {
    const child = spawn("sudo", ["-S", "installer", "-pkg", pkgPath, "-target", "/"], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let stderr = "";
    child.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    child.stdout.on("data", (d: Buffer) => {
      const line = d.toString().trim();
      if (line) log(line);
    });
    child.on("close", (c) => {
      try {
        fs.unlinkSync(/*turbopackIgnore: true*/ pkgPath);
      } catch {
        /* ignore */
      }
      if (c === 0) resolve();
      else {
        const msg =
          stderr.includes("incorrect password") || stderr.includes("Sorry")
            ? "Wrong sudo password"
            : stderr || `Exit code ${c}`;
        reject(new Error(msg));
      }
    });
    child.on("error", reject);
    child.stdin!.write(`${sudoPassword}\n`);
    child.stdin!.end();
  });
}

async function installTailscaleLinux(sudoPassword: string, log: (msg: string) => void) {
  log("Downloading install script...");
  return new Promise<void>((resolve, reject) => {
    const curlChild = spawn("curl", ["-fsSL", "https://tailscale.com/install.sh"], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let scriptContent = "";
    let curlErr = "";
    curlChild.stdout.on("data", (d: Buffer) => {
      scriptContent += d.toString();
    });
    curlChild.stderr.on("data", (d: Buffer) => {
      curlErr += d.toString();
    });
    curlChild.on("exit", (code) => {
      if (code !== 0) return reject(new Error(`Failed to download install script: ${curlErr}`));
      log("Running install script...");
      const child = spawn("sudo", ["-S", "sh"], {
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
      let stderr = "";
      child.stdout.on("data", (d: Buffer) => {
        const line = d.toString().trim();
        if (line) log(line);
      });
      child.stderr.on("data", (d: Buffer) => {
        stderr += d.toString();
      });
      child.on("close", (c) => {
        if (c === 0) resolve();
        else {
          const msg =
            stderr.includes("incorrect password") || stderr.includes("Sorry")
              ? "Wrong sudo password"
              : stderr || `Exit code ${c}`;
          reject(new Error(msg));
        }
      });
      child.on("error", reject);
      child.stdin!.write(`${sudoPassword}\n`);
      child.stdin!.write(scriptContent);
      child.stdin!.end();
    });
    curlChild.on("error", reject);
  });
}

async function installTailscaleWindows(log: (msg: string) => void) {
  const msiUrl = "https://pkgs.tailscale.com/stable/tailscale-setup-latest-amd64.msi";
  const msiPath = path.join(/*turbopackIgnore: true*/ os.tmpdir(), "tailscale-setup.msi");

  // Download MSI via curl.exe (built-in on Win10+) — no PowerShell window, streams progress
  log("Downloading Tailscale installer...");
  await new Promise<void>((resolve, reject) => {
    const child = spawn("curl.exe", ["-L", "-#", "-o", msiPath, msiUrl], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    // curl outputs progress to stderr with -# flag
    let lastPct = "";
    child.stderr.on("data", (d: Buffer) => {
      const text = d.toString();
      const match = text.match(/(\d+\.\d)%/);
      if (match && match[1] !== lastPct) {
        lastPct = match[1]!;
        log(`Downloading... ${lastPct}%`);
      }
    });
    child.on("close", (c) => (c === 0 ? resolve() : reject(new Error("Download failed"))));
    child.on("error", reject);
  });

  // Install MSI with UAC elevation via PowerShell Start-Process -Verb RunAs
  log("Installing Tailscale (UAC prompt may appear)...");
  await new Promise<void>((resolve, reject) => {
    const args = `'/i','${msiPath}','TS_NOLAUNCH=true','/quiet','/norestart'`;
    const child = spawn(
      "powershell",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `Start-Process msiexec -ArgumentList ${args} -Verb RunAs -Wait`,
      ],
      { stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
    );
    child.stderr.on("data", (d: Buffer) => {
      const l = d.toString().trim();
      if (l) log(l);
    });
    child.on("close", (c) => {
      try {
        fs.unlinkSync(/*turbopackIgnore: true*/ msiPath);
      } catch {
        /* ignore */
      }
      c === 0 ? resolve() : reject(new Error(`msiexec failed (code ${c})`));
    });
    child.on("error", reject);
  });

  // Verify tailscale.exe exists after install
  log("Verifying installation...");
  const maxWait = 10000;
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    if (fs.existsSync(/*turbopackIgnore: true*/ WINDOWS_TAILSCALE_BIN)) {
      log("Installation complete.");
      return;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("Installation finished but tailscale.exe not found");
}

/** Start tailscaled with sudo (TUN mode required for Funnel) */
export async function startDaemonWithPassword(sudoPassword: string) {
  if (IS_WINDOWS) {
    // Windows: tailscale runs as a Windows Service, try to start it
    try {
      const bin = getTailscaleBin();
      if (bin) {
        execSync(`"${bin}" status --json`, { stdio: "ignore", windowsHide: true, timeout: 3000 });
        return; // Already running
      }
    } catch {
      /* not running */
    }
    try {
      execSync("net start Tailscale", { stdio: "ignore", windowsHide: true, timeout: 10000 });
      await new Promise((r) => setTimeout(r, 3000));
    } catch {
      /* may need admin, or already running */
    }
    return;
  }

  // Check if daemon already responds
  try {
    const bin = getTailscaleBin() || "tailscale";
    execSync(`"${bin}" ${SOCKET_FLAG.join(" ")} status --json`, {
      stdio: "ignore",
      windowsHide: true,
      env: { ...process.env, PATH: EXTENDED_PATH },
      timeout: 3000,
    });
    return; // Already running
  } catch {
    /* not running, start it */
  }

  // Ensure config dir exists
  if (!fs.existsSync(/*turbopackIgnore: true*/ TAILSCALE_DIR)) {
    fs.mkdirSync(/*turbopackIgnore: true*/ TAILSCALE_DIR, { recursive: true });
  }

  // tailscaled requires root for TUN (needed for Funnel)
  const tailscaledBin = IS_MAC ? "/usr/local/bin/tailscaled" : "tailscaled";
  const daemonCmd = `${tailscaledBin} --socket=${TAILSCALE_SOCKET} --statedir=${TAILSCALE_DIR}`;

  // Start via sudo in background (nohup keeps it alive)
  await execWithPassword(`nohup ${daemonCmd} > /dev/null 2>&1 &`, sudoPassword || "");

  // Wait for daemon to be ready
  await new Promise((r) => setTimeout(r, 3000));
}

/** Best-effort: ensure daemon running (used for login flow) */
function ensureDaemon() {
  startDaemonWithPassword("").catch(() => {});
}

export interface LoginResult {
  alreadyLoggedIn?: boolean;
  authUrl?: string;
}

/**
 * Run `tailscale up` and capture the auth URL for browser login.
 * Resolves with { authUrl } or { alreadyLoggedIn: true }.
 */
export function startLogin(hostname: string): Promise<LoginResult> {
  const bin = getTailscaleBin();
  if (!bin) return Promise.reject(new Error("Tailscale not installed"));

  return new Promise((resolve, reject) => {
    // Ensure daemon is running (best-effort, no sudo)
    ensureDaemon();

    // Check if already logged in
    if (isTailscaleLoggedIn()) {
      resolve({ alreadyLoggedIn: true });
      return;
    }

    const parseAuthUrl = (text: string): string | null => {
      const match = text.match(/https:\/\/login\.tailscale\.com\/a\/[a-zA-Z0-9]+/);
      return match ? match[0] : null;
    };

    // Spawn detached so process survives API request lifecycle
    const args = tsArgs("up", "--accept-routes");
    if (hostname) args.push(`--hostname=${hostname}`);
    const child = spawn(bin, args, {
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
      windowsHide: true,
    });

    let resolved = false;
    let output = "";

    const timeout = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      // Don't kill — let tailscale up keep waiting for auth
      child.unref();
      const url = parseAuthUrl(output);
      if (url) resolve({ authUrl: url });
      else reject(new Error("tailscale up timed out without auth URL"));
    }, 15000);

    const handleData = (data: Buffer) => {
      output += data.toString();
      const url = parseAuthUrl(output);
      if (url && !resolved) {
        resolved = true;
        clearTimeout(timeout);
        // Keep process alive — unref so it doesn't block Node exit
        child.unref();
        resolve({ authUrl: url });
      }
    };

    child.stdout!.on("data", handleData);
    child.stderr!.on("data", handleData);

    child.on("error", (err) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      reject(err);
    });

    child.on("exit", (code) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      const url = parseAuthUrl(output);
      if (url) resolve({ authUrl: url });
      else if (code === 0 || isTailscaleLoggedIn()) resolve({ alreadyLoggedIn: true });
      else reject(new Error(`tailscale up exited with code ${code}`));
    });
  });
}

export interface FunnelResult {
  tunnelUrl?: string;
  funnelNotEnabled?: boolean;
  enableUrl?: string;
}

/** Start tailscale funnel for the given port */
export async function startFunnel(port: number): Promise<FunnelResult> {
  const bin = getTailscaleBin();
  if (!bin) throw new Error("Tailscale not installed");

  // Reset any existing funnel
  try {
    execSync(`"${bin}" ${SOCKET_FLAG.join(" ")} funnel --bg reset`, {
      stdio: "ignore",
      windowsHide: true,
    });
  } catch (_e) {
    /* ignore */
  }

  return new Promise((resolve, reject) => {
    const child = spawn(bin, tsArgs("funnel", "--bg", `${port}`), {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    let resolved = false;
    let output = "";

    const parseFunnelUrl = (text: string): string | null =>
      (text.match(/https:\/\/[a-z0-9-]+\.[a-z0-9.-]+\.ts\.net[^\s]*/i) || [])[0]?.replace(
        /\/$/,
        "",
      ) || null;

    const timeout = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      // --bg exits after setup, try status
      const url = getTailscaleFunnelUrl(port);
      if (url) resolve({ tunnelUrl: url });
      else reject(new Error(`Tailscale funnel timed out: ${output.trim() || "no output"}`));
    }, 30000);

    let funnelNotEnabled = false;

    const handleData = (data: Buffer) => {
      output += data.toString();

      if (output.includes("Funnel is not enabled")) funnelNotEnabled = true;

      // Wait for the enable URL to arrive in a later chunk
      if (funnelNotEnabled && !resolved) {
        const enableMatch = output.match(/https:\/\/login\.tailscale\.com\/[^\s]+/);
        if (enableMatch) {
          resolved = true;
          clearTimeout(timeout);
          child.kill();
          resolve({ funnelNotEnabled: true, enableUrl: enableMatch[0] });
          return;
        }
      }

      const url = parseFunnelUrl(output);
      if (url && !resolved) {
        resolved = true;
        clearTimeout(timeout);
        resolve({ tunnelUrl: url });
      }
    };

    child.stdout!.on("data", handleData);
    child.stderr!.on("data", handleData);

    child.on("exit", (code) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      const url = parseFunnelUrl(output) || getTailscaleFunnelUrl(port);
      if (url) resolve({ tunnelUrl: url });
      else reject(new Error(`tailscale funnel failed (code ${code}): ${output.trim()}`));
    });

    child.on("error", (err) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      reject(err);
    });
  });
}

/** Stop tailscale funnel */
export function stopFunnel() {
  const bin = getTailscaleBin();
  if (!bin) return;
  try {
    execSync(`"${bin}" ${SOCKET_FLAG.join(" ")} funnel --bg reset`, {
      stdio: "ignore",
      windowsHide: true,
    });
  } catch (_e) {
    /* ignore */
  }
}

/** Kill tailscaled daemon (runs as root, needs sudo) */
export async function stopDaemon(sudoPassword: string) {
  // Try non-sudo first
  try {
    execSync("pkill -x tailscaled", { stdio: "ignore", windowsHide: true, timeout: 3000 });
  } catch {
    /* ignore */
  }

  // Check if still alive
  try {
    execSync("pgrep -x tailscaled", { stdio: "ignore", windowsHide: true, timeout: 2000 });
  } catch {
    return;
  } // Dead, done

  // Kill with sudo password
  if (!IS_WINDOWS) {
    try {
      await execWithPassword("pkill -x tailscaled", sudoPassword || "");
    } catch {
      /* ignore */
    }
  }

  // Cleanup socket
  try {
    if (fs.existsSync(/*turbopackIgnore: true*/ TAILSCALE_SOCKET)) {
      fs.unlinkSync(/*turbopackIgnore: true*/ TAILSCALE_SOCKET);
    }
  } catch {
    /* ignore */
  }
}
