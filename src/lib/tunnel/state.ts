import path from "node:path";
import fs from "fs";
import { DATA_DIR } from "@/lib/dataDir";

const TUNNEL_DIR = path.join(/*turbopackIgnore: true*/ DATA_DIR, "tunnel");
const STATE_FILE = path.join(/*turbopackIgnore: true*/ TUNNEL_DIR, "state.json");
const CLOUDFLARED_PID_FILE = path.join(/*turbopackIgnore: true*/ TUNNEL_DIR, "cloudflared.pid");
const TAILSCALE_PID_FILE = path.join(/*turbopackIgnore: true*/ TUNNEL_DIR, "tailscale.pid");

function ensureDir() {
  if (!fs.existsSync(/*turbopackIgnore: true*/ TUNNEL_DIR)) {
    fs.mkdirSync(/*turbopackIgnore: true*/ TUNNEL_DIR, { recursive: true });
  }
}

export function loadState(): any {
  try {
    if (fs.existsSync(/*turbopackIgnore: true*/ STATE_FILE)) {
      return JSON.parse(fs.readFileSync(/*turbopackIgnore: true*/ STATE_FILE, "utf8")) as Record<
        string,
        unknown
      >;
    }
  } catch (_e) {
    /* ignore corrupt state */
  }
  return null;
}

export function saveState(state: any) {
  ensureDir();
  fs.writeFileSync(/*turbopackIgnore: true*/ STATE_FILE, JSON.stringify(state, null, 2));
}

export function clearState() {
  try {
    if (fs.existsSync(/*turbopackIgnore: true*/ STATE_FILE))
      fs.unlinkSync(/*turbopackIgnore: true*/ STATE_FILE);
  } catch (_e) {
    /* ignore */
  }
}

// Cloudflare-specific PID
export function savePid(pid: number) {
  ensureDir();
  fs.writeFileSync(/*turbopackIgnore: true*/ CLOUDFLARED_PID_FILE, pid.toString());
}

export function loadPid(): number | null {
  try {
    if (fs.existsSync(/*turbopackIgnore: true*/ CLOUDFLARED_PID_FILE)) {
      return parseInt(fs.readFileSync(/*turbopackIgnore: true*/ CLOUDFLARED_PID_FILE, "utf8"));
    }
  } catch (_e) {
    /* ignore */
  }
  return null;
}

export function clearPid() {
  try {
    if (fs.existsSync(/*turbopackIgnore: true*/ CLOUDFLARED_PID_FILE)) {
      fs.unlinkSync(/*turbopackIgnore: true*/ CLOUDFLARED_PID_FILE);
    }
  } catch (_e) {
    /* ignore */
  }
}

// Tailscale-specific PID
export function saveTailscalePid(pid: number) {
  ensureDir();
  fs.writeFileSync(/*turbopackIgnore: true*/ TAILSCALE_PID_FILE, pid.toString());
}

export function loadTailscalePid(): number | null {
  try {
    if (fs.existsSync(/*turbopackIgnore: true*/ TAILSCALE_PID_FILE)) {
      return parseInt(fs.readFileSync(/*turbopackIgnore: true*/ TAILSCALE_PID_FILE, "utf8"));
    }
  } catch (_e) {
    /* ignore */
  }
  return null;
}

export function clearTailscalePid() {
  try {
    if (fs.existsSync(/*turbopackIgnore: true*/ TAILSCALE_PID_FILE))
      fs.unlinkSync(/*turbopackIgnore: true*/ TAILSCALE_PID_FILE);
  } catch (_e) {
    /* ignore */
  }
}

const SHORT_ID_LENGTH = 6;
const SHORT_ID_CHARS = "abcdefghijklmnpqrstuvwxyz23456789";

export function generateShortId(): string {
  let result = "";
  for (let i = 0; i < SHORT_ID_LENGTH; i++) {
    result += SHORT_ID_CHARS.charAt(Math.floor(Math.random() * SHORT_ID_CHARS.length));
  }
  return result;
}
