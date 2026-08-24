import { execFileSync } from "node:child_process";
import path from "node:path";

export const HEADROOM_COMPRESSION_EXTRAS = ["code", "ml"] as const;
export type HeadroomCompressionExtra = (typeof HEADROOM_COMPRESSION_EXTRAS)[number];

export const EXTRA_MARKERS: Record<HeadroomCompressionExtra, string[]> = {
  code: ["tree-sitter", "tree-sitter-language-pack"],
  ml: ["torch", "huggingface-hub"],
};

const HEADROOM_PIP_TIMEOUT_MS = 8000;
const HEADROOM_HEALTH_TIMEOUT_MS = 1500;
const MIN_VERSION = [3, 10] as const;
const IS_WIN = process.platform === "win32";

const EXTRA_BINS = IS_WIN
  ? [
      `${process.env.LOCALAPPDATA || ""}\\Programs\\Python\\Python313\\Scripts`,
      `${process.env.LOCALAPPDATA || ""}\\Programs\\Python\\Python312\\Scripts`,
      `${process.env.LOCALAPPDATA || ""}\\Programs\\Python\\Python311\\Scripts`,
      `${process.env.APPDATA || ""}\\Python\\Python313\\Scripts`,
    ]
  : [
      "/usr/local/bin",
      "/opt/homebrew/bin",
      `${process.env.HOME || ""}/.local/bin`,
      "/usr/bin",
      "/bin",
    ];

const PYTHON_CANDIDATES = [
  "python3.13",
  "python3.12",
  "python3.11",
  "python3.10",
  "python3",
  "python",
];
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export const DEFAULT_HEADROOM_URL = process.env.HEADROOM_URL || "http://localhost:8787";
export const DEFAULT_HEADROOM_PORT = 8787;

const EXTENDED_PATH = [...EXTRA_BINS, process.env.PATH || ""].filter(Boolean).join(path.delimiter);

function execEnv(): NodeJS.ProcessEnv {
  return { ...process.env, PATH: EXTENDED_PATH };
}

export function findHeadroomBinary(): string | null {
  try {
    const cmd = IS_WIN ? "where" : "which";
    const out = execFileSync(cmd, ["headroom"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
      env: execEnv(),
    }).trim();
    return out.split(/\r?\n/)[0]?.trim() || null;
  } catch {
    return null;
  }
}

function pythonCandidates(): string[] {
  const list: string[] = [];
  const bin = findHeadroomBinary();
  if (bin) {
    const dir = path.dirname(bin);
    const names = IS_WIN ? ["python.exe", "python3.exe"] : ["python3", "python3.13", "python"];
    for (const n of names) list.push(path.join(dir, n));
  }
  for (const dir of EXTRA_BINS) {
    if (!dir) continue;
    for (const n of PYTHON_CANDIDATES) list.push(path.join(dir, IS_WIN ? `${n}.exe` : n));
  }
  list.push(...PYTHON_CANDIDATES);
  return list;
}

export function findPython310(): string | null {
  let fallback: string | null = null;
  for (const candidate of pythonCandidates()) {
    try {
      const ver = execFileSync(candidate, ["--version"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true,
        env: execEnv(),
      }).trim();
      const match = ver.match(/(\d+)\.(\d+)/);
      if (!match?.[1] || !match[2]) continue;
      const major = Number.parseInt(match[1], 10);
      const minor = Number.parseInt(match[2], 10);
      if (!(major > MIN_VERSION[0] || (major === MIN_VERSION[0] && minor >= MIN_VERSION[1]))) {
        continue;
      }
      if (!fallback) fallback = candidate;
      try {
        execFileSync(candidate, ["-m", "pip", "show", "headroom-ai"], {
          stdio: ["ignore", "pipe", "ignore"],
          windowsHide: true,
          timeout: HEADROOM_PIP_TIMEOUT_MS,
          env: execEnv(),
        });
        return candidate;
      } catch {
        // keep scanning
      }
    } catch {
      // candidate missing
    }
  }
  return fallback;
}

export async function probeProxyRunning(url: string): Promise<boolean> {
  if (!url || !isLoopbackHeadroomUrl(url)) return false;
  const parsed = new URL(url);
  parsed.port = String(resolveHeadroomPort(url));
  parsed.pathname = "/health";
  parsed.search = "";
  parsed.hash = "";
  try {
    const res = await fetch(parsed.toString(), {
      signal: AbortSignal.timeout(HEADROOM_HEALTH_TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function isLoopbackHeadroomUrl(url: unknown): boolean {
  if (typeof url !== "string" || !url) return false;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    return LOOPBACK_HOSTS.has(parsed.hostname) || LOOPBACK_HOSTS.has(host);
  } catch {
    return false;
  }
}

export function parsePortFromUrl(url: string): number | null {
  try {
    const port = Number.parseInt(new URL(url).port, 10);
    if (port > 0 && port < 65536) return port;
  } catch {
    // default later
  }
  return null;
}

/** Empty URL.port would fetch :80/:443 — spawn/proxy use Headroom's default instead. */
export function resolveHeadroomPort(url: string): number {
  return parsePortFromUrl(url) || DEFAULT_HEADROOM_PORT;
}

export type HeadroomExtrasStatus = {
  installed: boolean;
  version: string | null;
  extras: { code: boolean; ml: boolean };
};

export function getInstalledHeadroomExtras(python?: string | null): HeadroomExtrasStatus {
  const py = python || findPython310();
  if (!py) return { installed: false, version: null, extras: { code: false, ml: false } };
  try {
    const out = execFileSync(
      py,
      ["-m", "pip", "list", "--format=json", "--disable-pip-version-check"],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true,
        timeout: HEADROOM_PIP_TIMEOUT_MS,
        env: execEnv(),
      },
    );
    const packages = JSON.parse(out) as { name?: string; version?: string }[];
    const names = new Set(packages.map((p) => String(p.name || "").toLowerCase()));
    if (!names.has("headroom-ai")) {
      return { installed: false, version: null, extras: { code: false, ml: false } };
    }
    const version = packages.find((p) => p.name?.toLowerCase() === "headroom-ai")?.version || null;
    return {
      installed: true,
      version,
      extras: {
        code: EXTRA_MARKERS.code.some((m) => names.has(m)),
        ml: EXTRA_MARKERS.ml.some((m) => names.has(m)),
      },
    };
  } catch {
    return { installed: false, version: null, extras: { code: false, ml: false } };
  }
}

export async function getHeadroomStatus(url: string) {
  const binaryPath = findHeadroomBinary();
  const python = findPython310();
  const installed = Boolean(binaryPath);
  const running = await probeProxyRunning(url);
  const localUrl = isLoopbackHeadroomUrl(url);
  const extrasStatus = installed
    ? getInstalledHeadroomExtras(python)
    : { installed: false, version: null, extras: { code: false, ml: false } };
  return {
    installed,
    path: binaryPath,
    running,
    python,
    localUrl,
    canStart: installed && localUrl,
    version: extrasStatus.version,
    extras: extrasStatus.extras,
  };
}
