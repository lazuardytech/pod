import { getProviderConnections } from "@/lib/localDb";

const MODEL_LOCK_PREFIX = "modelLock_";
const CONN_LOCK_UNTIL_KEY = "connectionLockUntil";
const CONN_LOCK_COUNT_KEY = "connectionLockCount";
const CONN_LOCK_REASON_KEY = "connectionLockReason";

function getActiveModelLocks(connection: any) {
  const now = Date.now();
  return Object.entries(connection)
    .filter(([key, value]) => key.startsWith(MODEL_LOCK_PREFIX) && value)
    .map(([key, value]) => ({
      key,
      model: key.slice(MODEL_LOCK_PREFIX.length) || "__all",
      until: value,
      active: new Date(String(value)).getTime() > now,
    }))
    .filter((lock) => lock.active);
}

function getActiveConnectionLock(connection: any) {
  const until = connection[CONN_LOCK_UNTIL_KEY];
  if (!until) return null;
  const now = Date.now();
  if (new Date(until).getTime() <= now) return null;
  return {
    until,
    count: connection[CONN_LOCK_COUNT_KEY] || 1,
    reason: connection[CONN_LOCK_REASON_KEY] || null,
  };
}

export async function getModelAvailabilityPayload() {
  const connections = await getProviderConnections();
  const models: Record<string, unknown>[] = [];

  for (const connection of connections) {
    const connLock = getActiveConnectionLock(connection);
    if (connLock) {
      models.push({
        provider: connection.provider,
        model: "__connection",
        status: "connection-locked",
        until: connLock.until,
        lockCount: connLock.count,
        lockReason: connLock.reason,
        connectionId: connection.id,
        connectionName: connection.name || connection.email || connection.id,
        lastError: connection.lastError || null,
      });
      continue;
    }

    const locks = getActiveModelLocks(connection);
    for (const lock of locks) {
      models.push({
        provider: connection.provider,
        model: lock.model,
        status: "cooldown",
        until: lock.until,
        connectionId: connection.id,
        connectionName: connection.name || connection.email || connection.id,
        lastError: connection.lastError || null,
      });
    }

    if (locks.length === 0 && connection.testStatus === "unavailable") {
      models.push({
        provider: connection.provider,
        model: "__all",
        status: "unavailable",
        connectionId: connection.id,
        connectionName: connection.name || connection.email || connection.id,
        lastError: connection.lastError || null,
      });
    }
  }

  return {
    models,
    unavailableCount: models.length,
  };
}

export { MODEL_LOCK_PREFIX };
