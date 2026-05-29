import initializeApp from "@/shared/services/initializeApp";

// Survive Next.js HMR — module-level flag resets on reload, globalThis persists
// biome-ignore lint/suspicious/noAssignInExpressions: globalThis singleton pattern for HMR survival
const g = (globalThis.__cloudSyncInit ??= { initialized: false, inProgress: null });

export async function ensureAppInitialized() {
  if (g.initialized) return true;
  if (g.inProgress) return g.inProgress;
  g.inProgress = (async () => {
    try {
      await initializeApp();
      g.initialized = true;
    } catch (error) {
      console.error("[ServerInit] Error initializing app:", error); // boot-time, keep console
    } finally {
      g.inProgress = null;
    }
    return g.initialized;
  })();
  return g.inProgress;
}

// Auto-initialize at runtime only, not during next build
if (process.env.NEXT_PHASE !== "phase-production-build") {
  ensureAppInitialized().catch((err) => console.error("[ServerInit] Background init error:", err));
}

export default ensureAppInitialized;
