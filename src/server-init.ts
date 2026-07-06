import { registerShutdownHook, setupSignalHandlers } from "./lib/shutdown";
import initializeApp from "./shared/services/initializeApp";

process.on("unhandledRejection", (reason, promise) => {
  console.error("[FATAL] Unhandled Rejection at:", promise, "reason:", reason);
});

process.on("uncaughtException", (error) => {
  console.error("[FATAL] Uncaught Exception:", error);
});

async function startServer() {
  console.log("Starting server...");

  // Register tunnel cleanup hook before signal handlers
  registerShutdownHook(async () => {
    try {
      const { killCloudflared } = await import("./lib/tunnel/cloudflared.js");
      killCloudflared();
    } catch {}
    try {
      // biome-ignore lint/correctness/noUndeclaredVariables: runtime-injected global
      if (typeof removeAllDNSEntriesSync === "function") removeAllDNSEntriesSync();
    } catch {}
  });

  setupSignalHandlers();

  try {
    await initializeApp();
    console.log("Server initialized");
  } catch (error) {
    console.log("Error initializing server:", error);
    process.exit(1);
  }
}

startServer().catch(console.log);

export default startServer;
