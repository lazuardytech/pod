// Graceful shutdown orchestrator.
// Subsystems register cleanup hooks; the orchestrator runs them in reverse
// registration order when SIGINT or SIGTERM is received.

import { killCloudflared } from "./tunnel/cloudflared.js";
import { stopDaemon, stopFunnel } from "./tunnel/tailscale.js";

const hooks = [];
let shuttingDown = false;
const SHUTDOWN_TIMEOUT_MS = 10000;

export function isShuttingDown() {
  return shuttingDown;
}

export function registerShutdownHook(fn) {
  hooks.push(fn);
}

async function runShutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("[Shutdown] Graceful shutdown initiated");

  // Run hooks in reverse registration order (LIFO — most recent first)
  for (let i = hooks.length - 1; i >= 0; i--) {
    try {
      await hooks[i]();
    } catch (err) {
      console.log("[Shutdown] Hook error:", err?.message || err);
    }
  }

  // Tunnel cleanup
  try {
    killCloudflared();
  } catch {}

  try {
    stopFunnel();
  } catch {}

  try {
    await stopDaemon(null);
  } catch {}

  console.log("[Shutdown] Cleanup complete, exiting");
  process.exit(0);
}

export function setupSignalHandlers() {
  const handler = () => {
    // Safety net: force exit if shutdown takes too long
    setTimeout(() => process.exit(0), SHUTDOWN_TIMEOUT_MS).unref();

    runShutdown().catch(() => {
      console.log("[Shutdown] Forced exit");
      process.exit(0);
    });
  };

  process.once("SIGINT", handler);
  process.once("SIGTERM", handler);
}
