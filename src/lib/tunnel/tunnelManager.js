import crypto from "node:crypto";
import { machineIdSync } from "node-machine-id";
import { getSettings, updateSettings } from "@/lib/localDb";
import { isCloudflaredRunning, killCloudflared, setUnexpectedExitHandler, spawnQuickTunnel } from "./cloudflared.js";
import { probeUrlAlive } from "./networkProbe.js";
import { generateShortId, loadState, saveState } from "./state.js";
import {
  isTailscaleLoggedIn,
  isTailscaleRunning,
  startDaemonWithPassword,
  startFunnel,
  startLogin,
  stopFunnel,
} from "./tailscale.js";

// Removed initDbHooks call

const MACHINE_ID_SALT = "pod-tunnel-salt";

// Per-service state (independent: tunnel ≠ tailscale)
const tunnelSvc = {
  cancelToken: { cancelled: false },
  spawnInProgress: false,
  lastRestartAt: 0,
  activeLocalPort: null,
};

const tailscaleSvc = {
  cancelToken: { cancelled: false },
  spawnInProgress: false,
  lastRestartAt: 0,
  activeLocalPort: null,
};

export function getTunnelService() {
  return tunnelSvc;
}
export function getTailscaleService() {
  return tailscaleSvc;
}

export function isTunnelManuallyDisabled() {
  return tunnelSvc.cancelToken.cancelled;
}
export function isTunnelReconnecting() {
  return tunnelSvc.spawnInProgress;
}
export function isTailscaleReconnecting() {
  return tailscaleSvc.spawnInProgress;
}

function getMachineId() {
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

function throwIfCancelled(token, label) {
  if (token.cancelled) throw new Error(`${label} cancelled`);
}

export async function enableTunnel(localPort = 20128) {
  tunnelSvc.cancelToken = { cancelled: false };
  tunnelSvc.activeLocalPort = localPort;
  tunnelSvc.spawnInProgress = true;
  const token = tunnelSvc.cancelToken;

  try {
    if (isCloudflaredRunning()) {
      const existing = loadState();
      if (existing?.tunnelUrl && (await probeUrlAlive(existing.tunnelUrl))) {
        return {
          success: true,
          tunnelUrl: existing.tunnelUrl,
          shortId: existing.shortId,
          alreadyRunning: true,
        };
      }
    }

    killCloudflared(localPort);
    throwIfCancelled(token, "tunnel");

    const machineId = getMachineId();
    const existing = loadState();
    const shortId = existing?.shortId || generateShortId();

    const onUrlUpdate = async (url) => {
      if (token.cancelled) return;
      saveState({ shortId, machineId, tunnelUrl: url });
      await updateSettings({ tunnelEnabled: true, tunnelUrl: url });
    };

    const { tunnelUrl } = await spawnQuickTunnel(localPort, onUrlUpdate);
    throwIfCancelled(token, "tunnel");

    saveState({ shortId, machineId, tunnelUrl });
    await updateSettings({ tunnelEnabled: true, tunnelUrl });

    // Health probe is done client-side (pingTunnelHealth) — skip server-side
    // waitForHealth to avoid false failures when DNS is slow to propagate.

    return { success: true, tunnelUrl, shortId };
  } finally {
    tunnelSvc.spawnInProgress = false;
  }
}

export async function disableTunnel() {
  tunnelSvc.cancelToken.cancelled = true;
  setUnexpectedExitHandler(null);
  killCloudflared(tunnelSvc.activeLocalPort);

  const state = loadState();
  if (state) saveState({ shortId: state.shortId, machineId: state.machineId, tunnelUrl: null });

  await updateSettings({ tunnelEnabled: false, tunnelUrl: "" });
  return { success: true };
}

export async function getTunnelStatus() {
  const state = loadState();
  const running = isCloudflaredRunning();
  const settings = await getSettings();
  const shortId = state?.shortId || "";

  return {
    enabled: settings.tunnelEnabled === true && running,
    settingsEnabled: settings.tunnelEnabled === true,
    tunnelUrl: state?.tunnelUrl || "",
    shortId,
    running,
  };
}

// ─── Tailscale Funnel ─────────────────────────────────────────────────────────

export async function enableTailscale(localPort = 20128) {
  tailscaleSvc.cancelToken = { cancelled: false };
  tailscaleSvc.activeLocalPort = localPort;
  tailscaleSvc.spawnInProgress = true;
  const token = tailscaleSvc.cancelToken;

  try {
    const sudoPass = "";
    await startDaemonWithPassword(sudoPass);
    throwIfCancelled(token, "tailscale");

    const existing = loadState();
    const shortId = existing?.shortId || generateShortId();
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

export async function disableTailscale() {
  tailscaleSvc.cancelToken.cancelled = true;
  stopFunnel();
  await updateSettings({ tailscaleEnabled: false, tailscaleUrl: "" });
  return { success: true };
}

export async function getTailscaleStatus() {
  const settings = await getSettings();
  const running = isTailscaleRunning();
  return {
    enabled: settings.tailscaleEnabled === true && running,
    settingsEnabled: settings.tailscaleEnabled === true,
    tunnelUrl: settings.tailscaleUrl || "",
    running,
  };
}
