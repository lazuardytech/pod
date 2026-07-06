import crypto from "node:crypto";
import { machineIdSync } from "node-machine-id";

/**
 * Get consistent machine ID using node-machine-id with salt
 * This ensures the same physical machine gets the same ID across runs
 */
export async function getConsistentMachineId(salt: string | null = null): Promise<string> {
  // For server-side, use node-machine-id with salt
  const saltValue = salt || process.env.MACHINE_ID_SALT || "endpoint-proxy-salt";
  try {
    const rawMachineId = machineIdSync();
    // Create consistent ID using salt
    const hashedMachineId = crypto
      .createHash("sha256")
      .update(rawMachineId + saltValue)
      .digest("hex");
    // Return only first 16 characters for brevity
    return hashedMachineId.substring(0, 16);
  } catch (error) {
    console.error("Error getting machine ID:", error);
    // Fallback to random ID if node-machine-id fails
    return crypto.randomUUID
      ? crypto.randomUUID()
      : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
          const r = (Math.random() * 16) | 0;
          const v = c === "x" ? r : (r & 0x3) | 0x8;
          return v.toString(16);
        });
  }
}

/**
 * Get raw machine ID without hashing (for debugging purposes)
 */
export async function getRawMachineId(): Promise<string> {
  // For server-side, use raw node-machine-id
  try {
    return machineIdSync();
  } catch (error) {
    console.error("Error getting raw machine ID:", error);
    // Fallback to random ID if node-machine-id fails
    return crypto.randomUUID
      ? crypto.randomUUID()
      : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
          const r = (Math.random() * 16) | 0;
          const v = c === "x" ? r : (r & 0x3) | 0x8;
          return v.toString(16);
        });
  }
}

/**
 * Check if we're running in browser or server environment
 */
export function isBrowser(): boolean {
  return typeof window !== "undefined";
}
