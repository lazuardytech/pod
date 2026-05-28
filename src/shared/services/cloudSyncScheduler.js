import { isCloudEnabled } from "@/lib/localDb";
import { getConsistentMachineId } from "@/shared/utils/machineId";

const INTERNAL_BASE_URL = process.env.BASE_URL || process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:20128";

/**
 * Cloud sync scheduler
 */
export class CloudSyncScheduler {
  constructor(machineId = null, intervalMinutes = 15) {
    this.machineId = machineId;
    this.intervalMinutes = intervalMinutes;
    this.intervalId = null;
  }

  /**
   * Initialize machine ID if not provided
   */
  async initializeMachineId() {
    if (!this.machineId) {
      this.machineId = await getConsistentMachineId();
    }
  }

  /**
   * Start periodic sync (delays first sync to allow server to be ready)
   */
  async start() {
    if (this.intervalId) {
      return;
    }

    await this.initializeMachineId();

    // Delay first sync by 30 seconds to ensure server is ready
    setTimeout(() => {
      this.syncWithRetry().catch(() => {});
    }, 30000);

    // Then sync periodically
    this.intervalId = setInterval(
      () => {
        this.syncWithRetry().catch(() => {});
      },
      this.intervalMinutes * 60 * 1000,
    );
  }

  /**
   * Stop periodic sync
   */
  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /**
   * Sync with retry logic (exponential backoff)
   */
  async syncWithRetry(maxRetries = 1) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const result = await this.sync();
        return result;
      } catch (_error) {
        if (attempt === maxRetries) {
          return null;
        }

        const delay = Math.min(1000 * 2 ** attempt, 10000); // Max 10s
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  /**
   * Perform sync via internal API route (handles token update to db.json)
   */
  async sync() {
    // Check if cloud is enabled
    const enabled = await isCloudEnabled();
    if (!enabled) {
      return null;
    }

    await this.initializeMachineId();

    // Call internal API route which handles both sync and token update
    const response = await fetch(`${INTERNAL_BASE_URL}/api/sync/cloud`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ machineId: this.machineId, action: "sync" }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || "Sync failed");
    }

    const result = await response.json();
    this._lastSyncAt = new Date().toISOString();
    return result;
  }

  /**
   * Check if scheduler is running
   */
  isRunning() {
    return this.intervalId !== null;
  }
}

// Export a singleton instance if needed
let cloudSyncScheduler = null;

export async function getCloudSyncScheduler(machineId = null, intervalMinutes = 15) {
  if (!cloudSyncScheduler) {
    cloudSyncScheduler = new CloudSyncScheduler(machineId, intervalMinutes);
  }
  return cloudSyncScheduler;
}

/**
 * Returns cloud sync status for monitoring.
 */
export function getCloudSyncStatus() {
  if (!cloudSyncScheduler) {
    return { enabled: false, isRunning: false, lastSyncAt: null };
  }
  return {
    enabled: true,
    isRunning: cloudSyncScheduler.isRunning(),
    lastSyncAt: cloudSyncScheduler._lastSyncAt ?? null,
  };
}
