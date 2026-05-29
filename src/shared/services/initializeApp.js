import os from "node:os";
import { cleanupProviderConnections, getSettings } from "@/lib/localDb";
import { ensureCloudflared, isCloudflaredRunning, killCloudflared } from "@/lib/tunnel/cloudflared";
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

// Warn about default secrets
if (process.env.JWT_SECRET === "pod-default-secret-change-me" || !process.env.JWT_SECRET) {
  console.warn("[SECURITY] WARNING: JWT_SECRET is set to default value. Set a strong random secret in production.");
}
if ((process.env.API_KEY_SECRET || "endpoint-proxy-api-key-secret") === "endpoint-proxy-api-key-secret") {
  console.warn("[SECURITY] WARNING: API_KEY_SECRET is set to default value. Set a strong random secret in production.");
}
if (!process.env.INITIAL_PASSWORD && !process.env.JWT_SECRET) {
  console.warn(
    "[SECURITY] WARNING: No INITIAL_PASSWORD and no JWT_SECRET set. Default login password is '123456'. Set INITIAL_PASSWORD in production.",
  );
}

export async function initializeApp() {
  try {
    await cleanupProviderConnections();
    const settings = await getSettings();

    // Start models.dev pricing sync
    const { startPeriodicSync } = await import("@/lib/modelsDevSync.js");
    const intervalHours = settings.modelCostSyncIntervalHours ?? 1;
    startPeriodicSync(intervalHours * 60 * 60 * 1000);

    // Auto-resume tunnel
    if (settings.tunnelEnabled) {
      console.log("[InitApp] Tunnel was enabled, auto-resuming...");
      safeRestartTunnel("startup").catch((e) => console.log("[InitApp] Tunnel resume failed:", e.message));
    }

    // Auto-resume tailscale
    if (settings.tailscaleEnabled) {
      console.log("[InitApp] Tailscale was enabled, auto-resuming...");
      safeRestartTailscale("startup").catch((e) => console.log("[InitApp] Tailscale resume failed:", e.message));
    }

    if (!g.signalHandlersRegistered) {
      const cleanup = () => {
        try {
          // biome-ignore lint/correctness/noUndeclaredVariables: runtime-injected global
          removeAllDNSEntriesSync();
        } catch {
          /* best effort */
        }
        killCloudflared();
        // Don't call process.exit() here — later handlers (usageDb, requestDetailsDb)
        // registered on module import need time to flush their queues.
        // Process exits naturally when event loop drains.
        // Safety net: force exit after 5s in case something hangs.
        setTimeout(() => process.exit(1), 5000).unref();
      };
      process.on("SIGINT", cleanup);
      process.on("SIGTERM", cleanup);
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
    console.error("[InitApp] Error:", error);
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

  console.log(`[Tunnel] safeRestart (${reason})`);
  try {
    await enableTunnel();
    svc.lastRestartAt = Date.now();
    console.log("[Tunnel] restart success");
  } catch (err) {
    console.log("[Tunnel] restart failed:", err.message);
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

  console.log(`[Tailscale] safeRestart (${reason})`);
  try {
    await enableTailscale();
    svc.lastRestartAt = Date.now();
    console.log("[Tailscale] restart success");
  } catch (err) {
    console.log("[Tailscale] restart failed:", err.message);
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
      console.log("[NetworkMonitor] error:", err.message);
    }
  }, NETWORK_CHECK_INTERVAL_MS);

  if (g.networkMonitorInterval.unref) g.networkMonitorInterval.unref();
}

export default initializeApp;
