import { getConsistentMachineId } from "./machineId";

// Get machine ID using node-machine-id with salt
export async function getMachineId(): Promise<string> {
  return await getConsistentMachineId();
}

// Keep sync functions for backward compatibility but make them no-ops
// (Frontend sync is disabled - use backend sync instead)
export async function syncProviderDataToCloud(_cloudUrl: string): Promise<boolean> {
  console.warn("Frontend sync is disabled. Use backend sync instead.");
  return Promise.resolve(true);
}

export async function getProvidersNeedingRefresh(): Promise<unknown[]> {
  console.warn("Frontend sync is disabled. Use backend sync instead.");
  return Promise.resolve([]);
}
