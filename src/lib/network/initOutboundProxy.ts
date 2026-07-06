import { getSettings } from "@/lib/localDb";
import { applyOutboundProxyEnv } from "@/lib/network/outboundProxy";

let initialized = false;

export async function ensureOutboundProxyInitialized(): Promise<boolean> {
  if (initialized) return true;

  try {
    const settings = await getSettings();
    applyOutboundProxyEnv(settings);
    initialized = true;
  } catch (error) {
    console.error("[ServerInit] Error initializing outbound proxy:", error); // boot-time, keep console
  }

  return initialized;
}

ensureOutboundProxyInitialized().catch((err) =>
  console.error("[ServerInit] Outbound proxy init error:", err),
);

export default ensureOutboundProxyInitialized;
