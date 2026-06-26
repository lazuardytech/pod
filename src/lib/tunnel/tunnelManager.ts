import crypto from "node:crypto";
import { machineIdSync } from "node-machine-id";
import { getSettings, updateSettings } from "@/lib/localDb";
import {
  isCloudflaredRunning,
  killCloudflared,
  setUnexpectedExitHandler,
  spawnQuickTunnel,
} from "./cloudflared.ts";
import { probeUrlAlive } from "./networkProbe.ts";
import { generateShortId, loadState, saveState } from "./state.ts";

const MACHINE_ID_SALT = "pod-tunnel-salt";

interface CancelToken {
  cancelled: boolean;
}

interface PerServiceState {
  cancelToken: CancelToken;
  spawnInProgress: boolean;
  lastRestartAt: number;
  activeLocalPort: number | null;
}

// Per-service state (independent: tunnel ≠ tailscale)
const tunnelSvc: PerServiceState = {
  cancelToken: { cancelled: false },
  spawnInProgress: false,
  lastRestartAt: 0,
  activeLocalPort: null,
};

const tailscaleSvc: PerServiceState = {
  cancelToken: { cancelled: false },
  spawnInProgress: false,
  lastRestartAt: 0,
  activeLocalPort: null,
};

export function getTunnelService(): PerServiceState {
  return tunnelSvc;
}
export function getTailscaleService(): PerServiceState {
  return tailscaleSvc;
}

export function isTunnelManuallyDisabled(): boolean {
  return tunnelSvc.cancelToken.cancelled;
}
export function isTunnelReconnecting(): boolean {
  return tunnelSvc.spawnInProgress;
}
export function isTailscaleReconnecting(): boolean {
  return tailscaleSvc.spawnInProgress;
}

function getMachineId(): string {
  try {
    const raw = machineIdSync();
    return crypto
      .createHash("sha256")
      .update(raw + MACHINE_ID_SALT)
      .digest("hex")
      .substring(0, 16);
  } catch (_e) {
    return crypto.randomUUID().replace(/-/g, "").substring(0, 16);
  }
}

// ─── Cloudflare Tunnel ───────────────────────────────────────────────────────
//
// Pod uses Cloudflare's standard trycloudflare.com quick-tunnel URLs directly.
// `shortId` is kept in persisted state for backward compatibility with installs
// from earlier versions, but is no longer used to build a public URL.

function throwIfCancelled(token: CancelToken, label: string) {
  if (token.cancelled) throw new Error(`${label} cancelled`);
}

async function getTailscaleModule(): Promise<typeof import("./tailscale.ts")> {
  return import("./tailscale.ts");
}

export interface TunnelEnableResult {
  success: boolean;
  tunnelUrl?: string;
  shortId?: string;
  alreadyRunning?: boolean;
}

export async function enableTunnel(localPort: number = 20128): Promise<TunnelEnableResult> {
  tunnelSvc.cancelToken = { cancelled: false };
  tunnelSvc.activeLocalPort = localPort;
  tunnelSvc.spawnInProgress = true;
  const token = tunnelSvc.cancelToken;

  try {
    if (isCloudflaredRunning()) {
      const existing = loadState() as Record<string, unknown> | null;
      if (existing?.tunnelUrl && (await probeUrlAlive(existing.tunnelUrl as string))) {
        return {
          success: true,
          tunnelUrl: existing.tunnelUrl as string,
          shortId: existing.shortId as string,
          alreadyRunning: true,
        };
      }
    }

    killCloudflared(localPort);
    throwIfCancelled(token, "tunnel");

    const machineId = getMachineId();
    const existing = loadState() as Record<string, unknown> | null;
    const shortId = (existing?.shortId as string) || generateShortId();

    const onUrlUpdate = async (url: string) => {
      if (token.cancelled) return;
      saveState({ shortId, machineId, tunnelUrl: url } as Record<string, unknown>);
      await updateSettings({ tunnelEnabled: true, tunnelUrl: url });
    };

    const { tunnelUrl } = await spawnQuickTunnel(localPort, onUrlUpdate);
    throwIfCancelled(token, "tunnel");

    saveState({ shortId, machineId, tunnelUrl } as Record<string, unknown>);
    await updateSettings({ tunnelEnabled: true, tunnelUrl });

    // Health probe is done client-side (pingTunnelHealth) — skip server-side
    // waitForHealth to avoid false failures when DNS is slow to propagate.

    return { success: true, tunnelUrl, shortId };
  } finally {
    tunnelSvc.spawnInProgress = false;
  }
}

export async function disableTunnel(): Promise<{ success: boolean }> {
  tunnelSvc.cancelToken.cancelled = true;
  setUnexpectedExitHandler(null);
  killCloudflared(tunnelSvc.activeLocalPort!);

  const state = loadState() as Record<string, unknown> | null;
  if (state) saveState({ shortId: state.shortId, machineId: state.machineId, tunnelUrl: null } as Record<string, unknown>);

  await updateSettings({ tunnelEnabled: false, tunnelUrl: "" });
  return { success: true };
}

export interface TunnelStatus {
  enabled: boolean;
  settingsEnabled: boolean;
  tunnelUrl: string;
  shortId: string;
  running: boolean;
}

export async function getTunnelStatus(): Promise<TunnelStatus> {
  const state = loadState() as Record<string, unknown> | null;
  const running = isCloudflaredRunning();
  const settings = await getSettings();
  const shortId = (state?.shortId as string) || "";

  return {
    enabled: settings.tunnelEnabled === true && running,
    settingsEnabled: settings.tunnelEnabled === true,
    tunnelUrl: (state?.tunnelUrl as string) || "",
    shortId,
    running,
  };
}

// ─── Tailscale Funnel ─────────────────────────────────────────────────────────

export interface TailscaleEnableResult {
  success: boolean;
  tunnelUrl?: string;
  needsLogin?: boolean;
  authUrl?: string;
  funnelNotEnabled?: boolean;
  enableUrl?: string;
  error?: string;
}

export async function enableTailscale(localPort: number = 20128): Promise<TailscaleEnableResult> {
  tailscaleSvc.cancelToken = { cancelled: false };
  tailscaleSvc.activeLocalPort = localPort;
  tailscaleSvc.spawnInProgress = true;
  const token = tailscaleSvc.cancelToken;

  try {
    const { isTailscaleLoggedIn, isTailscaleRunning, startDaemonWithPassword, startFunnel, startLogin, stopFunnel } =
      await getTailscaleModule();
    const sudoPass = "";
    await startDaemonWithPassword(sudoPass);
    throwIfCancelled(token, "tailscale");

    const existing = loadState() as Record<string, unknown> | null;
    const shortId = (existing?.shortId as string) || generateShortId();
    const tsHostname = shortId;

    if (!isTailscaleLoggedIn()) {
      const loginResult = await startLogin(tsHostname);
      if (loginResult.authUrl) return { success: false, needsLogin: true, authUrl: loginResult.authUrl };
    }
    throwIfCancelled(token, "tailscale");

    stopFunnel();
    const result = await startFunnel(localPort);
    throwIfCancelled(token, "tailscale");

    if (result.funnelNotEnabled) {
      return { success: false, funnelNotEnabled: true, enableUrl: result.enableUrl };
    }

    if (!isTailscaleLoggedIn() || !isTailscaleRunning()) {
      stopFunnel();
      return { success: false, error: "Tailscale not connected. Device may have been removed. Please re-login." };
    }

    await updateSettings({ tailscaleEnabled: true, tailscaleUrl: result.tunnelUrl });

    // Health probe is done client-side — skip server-side waitForHealth.

    return { success: true, tunnelUrl: result.tunnelUrl };
  } finally {
    tailscaleSvc.spawnInProgress = false;
  }
}

export async function disableTailscale(): Promise<{ success: boolean }> {
  const { stopFunnel } = await getTailscaleModule();
  tailscaleSvc.cancelToken.cancelled = true;
  stopFunnel();
  await updateSettings({ tailscaleEnabled: false, tailscaleUrl: "" });
  return { success: true };
}

export interface TailscaleStatus {
  enabled: boolean;
  settingsEnabled: boolean;
  tunnelUrl: string;
  running: boolean;
}

export async function getTailscaleStatus(): Promise<TailscaleStatus> {
  const { isTailscaleRunning } = await getTailscaleModule();
  const settings = await getSettings();
  const running = isTailscaleRunning();
  return {
    enabled: settings.tailscaleEnabled === true && running,
    settingsEnabled: settings.tailscaleEnabled === true,
    tunnelUrl: settings.tailscaleUrl || "",
    running,
  };
}
