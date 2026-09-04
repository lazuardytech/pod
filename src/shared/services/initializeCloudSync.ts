import { cleanupProviderConnections } from "@/lib/localDb";

/**
 * Cloud sync was replaced by the tunnel subsystem; the scheduler is
 * intentionally not started. This function remains as a no-op so the
 * import surface (used by historical cloud/ and tests) stays stable.
 */
export async function initializeCloudSync(): Promise<null> {
  await cleanupProviderConnections();
  return null;
}

export default initializeCloudSync;
