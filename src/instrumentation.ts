// Next.js 16 instrumentation — runs once at server startup in production & dev.
// Never runs in browser or during build. The canonical way to run startup code
// in Next.js standalone mode (no experimental.instrumentationHook needed).

export async function register() {
  // Register shutdown hooks + signal handlers
  const { registerShutdownHook, setupSignalHandlers } = await import("@/lib/shutdown");
  const { killCloudflared } = await import("@/lib/tunnel/cloudflared");

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

  // Initialize app in background — don't block server startup.
  // Rate limiter, tunnel, watchdog, etc. will finish asynchronously.
  const { default: initializeApp } = await import("@/shared/services/initializeApp");
  initializeApp().catch((err) => console.error("[Init] Background init error:", err));
}
