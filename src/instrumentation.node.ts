// Node-only startup. Imported from instrumentation.ts only when
// NEXT_RUNTIME === "nodejs" so Edge instrumentation never bundles node:fs
// (tailscale / cloudflared / sqlite).

import { registerShutdownHook, setupSignalHandlers } from "@/lib/shutdown";
import { killCloudflared } from "@/lib/tunnel/cloudflared";
import initializeApp from "@/shared/services/initializeApp";

// ponytail: 1-second dedupe + classify abort errors as client disconnects (not fatal).
// Mirrors the same handler in server-init.ts (dev/dual-mount fallback).
const abortLogCounts = new Map<string, { count: number; firstAt: number }>();
const ABORT_DEDUPE_WINDOW_MS = 1000;
const ABORT_DEDUPE_THRESHOLD = 5;

function isAbortReason(reason: unknown): boolean {
  if (!reason || typeof reason !== "object") return false;
  const r = reason as { name?: unknown; message?: unknown; stack?: unknown };
  if (r.name === "AbortError") return true;
  if (typeof r.message === "string" && r.message.toLowerCase().includes("aborted")) return true;
  if (typeof r.stack === "string" && r.stack.includes("node:_http_server")) return true;
  return false;
}

function logAbortDeduped(reason: unknown): void {
  const key =
    typeof reason === "object" &&
    reason !== null &&
    "message" in reason &&
    typeof (reason as { message?: unknown }).message === "string"
      ? (reason as { message: string }).message
      : "abort";
  const now = Date.now();
  const entry = abortLogCounts.get(key);
  if (!entry || now - entry.firstAt > ABORT_DEDUPE_WINDOW_MS) {
    abortLogCounts.set(key, { count: 1, firstAt: now });
    console.log("[ClientDisconnect] (deduped) reason:", reason);
    return;
  }
  entry.count++;
  if (entry.count === ABORT_DEDUPE_THRESHOLD) {
    console.log(
      `[ClientDisconnect] suppressed ${ABORT_DEDUPE_THRESHOLD}+ similar abort errors in 1s`,
    );
  }
}

export async function register(): Promise<void> {
  process.on("unhandledRejection", (reason, promise) => {
    if (isAbortReason(reason)) {
      logAbortDeduped(reason);
      return;
    }
    console.error("[FATAL] Unhandled Rejection at:", promise, "reason:", reason);
  });

  process.on("uncaughtException", (error) => {
    if (isAbortReason(error)) {
      logAbortDeduped(error);
      return;
    }
    console.error("[FATAL] Uncaught Exception:", error);
  });

  registerShutdownHook(async () => {
    try {
      killCloudflared();
    } catch {
      /* ignore */
    }
    try {
      // biome-ignore lint/correctness/noUndeclaredVariables: runtime-injected global
      if (typeof removeAllDNSEntriesSync === "function") removeAllDNSEntriesSync();
    } catch {
      /* ignore */
    }
  });

  setupSignalHandlers();

  initializeApp().catch((err) => console.error("[Init] Background init error:", err));
}
