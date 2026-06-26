import os from "node:os";
import { cleanupProviderConnections, getSettings } from "@/lib/localDb";
import { initRateLimit } from "@/lib/rateLimit";
import { validateStartupSecrets } from "@/lib/security/runtimeSecrets.mts";
import { error as logError, info as logInfo } from "@/sse/utils/logger.js";

import { ensureCloudflared, isCloudflaredRunning } from "@/lib/tunnel/cloudflared";
import { checkInternet, probeUrlAlive } from "@/lib/tunnel/networkProbe";
import { loadState } from "@/lib/tunnel/state";
import { isTailscaleRunning } from "@/lib/tunnel/tailscale";
import {
  NETWORK_CHECK_INTERVAL_MS,
  NETWORK_SETTLE_MS,
  RESTART_COOLDOWN_MS,
  WATCHDOG_INTERVAL_MS,
} from "@/lib/tunnel/tunnelConfig";
import { enableTailscale, enableTunnel, getTailscaleService, getTunnelService } from "@/lib/tunnel/tunnelManager";

process.setMaxListeners(20);

// Survive Next.js hot reload
// biome-ignore lint/suspicious/noAssignInExpressions: globalThis singleton pattern for HMR survival
const g = (global.__appSingleton ??= {
  signalHandlersRegistered: false,
  watchdogInterval: null,
  networkMonitorInterval: null,
  lastNetworkFingerprint: null,
  lastWatchdogTick: Date.now(),
});

export async function initializeApp() {
  try {
    validateStartupSecrets();

    // Init rate limit backend (Redis if REDIS_URL set, else in-memory)
    await initRateLimit().catch((err) => logError("InitApp", "Rate limit init failed", { error: err?.message || err }));

    await cleanupProviderConnections();
    const settings = await getSettings();

    // Start models.dev pricing sync
    const { startPeriodicSync } = await import("@/lib/modelsDevSync.js");
    const intervalHours = settings.modelCostSyncIntervalHours ?? 1;
    startPeriodicSync(intervalHours * 60 * 60 * 1000);

    // Auto-resume tunnel
    if (settings.tunnelEnabled) {
      logInfo("InitApp", "Tunnel was enabled, auto-resuming");
      safeRestartTunnel("startup").catch((e) =>
        logError("InitApp", "Tunnel resume failed", { error: e?.message || e }),
      );
    }

    // Auto-resume tailscale
    if (settings.tailscaleEnabled) {
      logInfo("InitApp", "Tailscale was enabled, auto-resuming");
      safeRestartTailscale("startup").catch((e) =>
        logError("InitApp", "Tailscale resume failed", { error: e?.message || e }),
      );
    }

    if (!g.signalHandlersRegistered) {
      // Signal handlers now managed by src/lib/shutdown.js (called from server-init.js).
      // Keep the exit handler for DNS cleanup as a safety net.
      process.on("exit", () => {
        try {
          // biome-ignore lint/correctness/noUndeclaredVariables: runtime-injected global
          removeAllDNSEntriesSync();
        } catch {
          /* ignore */
        }
      });
      g.signalHandlersRegistered = true;
    }

    ensureCloudflared().catch(() => {});

    startWatchdog();
    startNetworkMonitor();
    // autoStartMitm();
  } catch (error) {
    logError("InitApp", "Initialization failed", { error: error?.message || error });
    throw error;
  }
}

// Removed bootstrap block

// ─── Safe restart (4 guards: spawn / cooldown / alive / internet) ────────────

async function safeRestartTunnel(reason) {
  const svc = getTunnelService();
  const settings = await getSettings();
  if (!settings.tunnelEnabled) return;
  if (svc.cancelToken.cancelled) return;
  if (svc.spawnInProgress) return;
  if (Date.now() - svc.lastRestartAt < RESTART_COOLDOWN_MS) return;

  // Alive check: process up + URL responds → skip
  if (isCloudflaredRunning()) {
    const state = loadState();
    if (state?.tunnelUrl && (await probeUrlAlive(state.tunnelUrl))) return;
  }

  if (!(await checkInternet())) return;

  logInfo("Tunnel", `safeRestart (${reason})`);
  try {
    await enableTunnel();
    svc.lastRestartAt = Date.now();
    logInfo("Tunnel", "restart success");
  } catch (err) {
    logError("Tunnel", "restart failed", { error: err?.message || err });
  }
}

async function safeRestartTailscale(reason) {
  const svc = getTailscaleService();
  const settings = await getSettings();
  if (!settings.tailscaleEnabled) return;
  if (svc.cancelToken.cancelled) return;
  if (svc.spawnInProgress) return;
  if (Date.now() - svc.lastRestartAt < RESTART_COOLDOWN_MS) return;

  if (isTailscaleRunning() && settings.tailscaleUrl) {
    if (await probeUrlAlive(settings.tailscaleUrl)) return;
  }

  if (!(await checkInternet())) return;

  logInfo("Tailscale", `safeRestart (${reason})`);
  try {
    await enableTailscale();
    svc.lastRestartAt = Date.now();
    logInfo("Tailscale", "restart success");
  } catch (err) {
    logError("Tailscale", "restart failed", { error: err?.message || err });
  }
}

// ─── Watchdog: 60s tick check both services ──────────────────────────────────

function startWatchdog() {
  if (g.watchdogInterval) return;
  g.watchdogInterval = setInterval(() => {
    safeRestartTunnel("watchdog").catch(() => {});
    safeRestartTailscale("watchdog").catch(() => {});
  }, WATCHDOG_INTERVAL_MS);
  if (g.watchdogInterval.unref) g.watchdogInterval.unref();
}

// ─── Network monitor: detect IPv4 fingerprint change + sleep/wake ────────────

function getNetworkFingerprint() {
  const interfaces = os.networkInterfaces();
  const active = [];
  for (const [name, addrs] of Object.entries(interfaces)) {
    if (!addrs) continue;
    for (const addr of addrs) {
      if (!addr.internal && addr.family === "IPv4") {
        active.push(`${name}:${addr.address}`);
      }
    }
  }
  return active.sort().join("|");
}

function startNetworkMonitor() {
  if (g.networkMonitorInterval) return;

  g.lastNetworkFingerprint = getNetworkFingerprint();
  g.lastWatchdogTick = Date.now();

  g.networkMonitorInterval = setInterval(async () => {
    try {
      const now = Date.now();
      const elapsed = now - g.lastWatchdogTick;
      g.lastWatchdogTick = now;

      const currentFingerprint = getNetworkFingerprint();
      const networkChanged = currentFingerprint !== g.lastNetworkFingerprint;
      const wasSleep = elapsed > NETWORK_CHECK_INTERVAL_MS * 3;

      if (networkChanged) g.lastNetworkFingerprint = currentFingerprint;
      if (!networkChanged && !wasSleep) return;

      // Wait for DHCP/DNS to settle before probing
      await new Promise((r) => setTimeout(r, NETWORK_SETTLE_MS));

      const reason = wasSleep && networkChanged ? "sleep+netchange" : wasSleep ? "sleep" : "netchange";
      safeRestartTunnel(reason).catch(() => {});
      safeRestartTailscale(reason).catch(() => {});
    } catch (err) {
      logError("NetworkMonitor", "error", { error: err?.message || err });
    }
  }, NETWORK_CHECK_INTERVAL_MS);

  if (g.networkMonitorInterval.unref) g.networkMonitorInterval.unref();
}

export default initializeApp;
