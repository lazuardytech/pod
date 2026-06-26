import { MAX_RATE_LIMIT_COOLDOWN_MS } from "open-sse/config/errorConfig.js";
import {
  buildConnectionLockUpdate,
  buildModelLockUpdate,
  checkFallbackError,
  CONN_LOCK_COUNT_KEY,
  CONN_LOCK_REASON_KEY,
  CONN_LOCK_UNTIL_KEY,
  formatRetryAfter,
  getConnectionLockUntil,
  getEarliestModelLockUntil,
  getModelLockCount,
  getModelLockCountKey,
  isConnectionLevelError,
  isConnectionLockActive,
  isModelLockActive,
  MODEL_LOCK_COUNT_PREFIX,
} from "open-sse/services/accountFallback.js";
import { getProviderConnections, getSettings, updateProviderConnection, validateApiKey } from "@/lib/localDb";
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy";
import { FREE_PROVIDERS, resolveProviderId } from "@/shared/constants/providers";
import * as log from "../utils/logger";

type RotationState = { lastConnectionId: string; consecutiveCount: number };
const rotationState = new Map<string, RotationState>();
type PersistEntry = { lastUsedAt?: string; consecutiveUseCount?: number; timer?: ReturnType<typeof setTimeout> };
const persistQueue = new Map<string, PersistEntry>();
const PERSIST_DEBOUNCE_MS = 1000;
type ConnectionsCacheEntry = { connections: AnyConnection[]; fetchedAt: number };
const connectionsCache = new Map<string, ConnectionsCacheEntry>();
const CONNECTIONS_CACHE_TTL_MS = 1000;
type AnyConnection = Record<string, any>;

export function invalidateConnectionsCache(providerId?: string): void {
  if (providerId) connectionsCache.delete(providerId);
  else connectionsCache.clear();
}
async function getCachedActiveConnections(providerId: string): Promise<AnyConnection[]> {
  const entry = connectionsCache.get(providerId);
  const now = Date.now();
  if (entry && now - entry.fetchedAt < CONNECTIONS_CACHE_TTL_MS) return entry.connections;
  for (const [k, v] of connectionsCache) {
    if (now - v.fetchedAt >= CONNECTIONS_CACHE_TTL_MS) connectionsCache.delete(k);
  }
  const connections = await getProviderConnections({ provider: providerId, isActive: true });
  connectionsCache.set(providerId, { connections: connections as AnyConnection[], fetchedAt: now });
  return connections as AnyConnection[];
}
function schedulePersist(connectionId: string, fields: PersistEntry): void {
  const existing = persistQueue.get(connectionId);
  if (existing?.timer) clearTimeout(existing.timer);
  const merged: PersistEntry = { ...(existing || {}), ...fields };
  merged.timer = setTimeout(() => {
    const { timer, ...payload } = persistQueue.get(connectionId) || {};
    persistQueue.delete(connectionId);
    updateProviderConnection(connectionId, payload).catch((err: unknown) => {
      log.debug("AUTH", `Persist rotation failed: ${(err as { message?: string })?.message || err}`);
    });
  }, PERSIST_DEBOUNCE_MS);
  persistQueue.set(connectionId, merged);
}

export type CredentialsResult = AnyConnection & {
  apiKey?: string;
  accessToken?: string;
  refreshToken?: string;
  projectId?: string;
  connectionName?: string;
  copilotToken?: string;
  providerSpecificData?: Record<string, unknown>;
  connectionId?: string;
  testStatus?: string;
  lastError?: string | null;
  _connection?: AnyConnection;
  allRateLimited?: boolean;
  retryAfter?: string | null;
  retryAfterHuman?: string;
  lastErrorCode?: number | null;
};

export async function getProviderCredentials(
  provider: string,
  excludeConnectionIds: Set<string> | string | null = null,
  model: string | null = null,
  options: { preferredConnectionId?: string | null } = {},
): Promise<CredentialsResult | null> {
  const excludeSet: Set<string> =
    excludeConnectionIds instanceof Set
      ? excludeConnectionIds
      : excludeConnectionIds
        ? new Set([excludeConnectionIds])
        : new Set();
  const preferredConnectionId = options?.preferredConnectionId || null;
  try {
    const providerId = resolveProviderId(provider);
    if (FREE_PROVIDERS[providerId]?.noAuth) {
      const settings = await getSettings();
      const override = (settings.providerStrategies || {})[providerId] || {};
      const resolvedProxy = await resolveConnectionProxyConfig({ proxyPoolId: override.proxyPoolId || "" });
      return {
        id: "noauth",
        connectionName: "Public",
        isActive: true,
        accessToken: "public",
        providerSpecificData: {
          connectionProxyEnabled: resolvedProxy.connectionProxyEnabled,
          connectionProxyUrl: resolvedProxy.connectionProxyUrl,
          connectionNoProxy: resolvedProxy.connectionNoProxy,
          connectionProxyPoolId: resolvedProxy.proxyPoolId || null,
          vercelRelayUrl: resolvedProxy.vercelRelayUrl || "",
        },
      };
    }
    const connections = await getCachedActiveConnections(providerId);
    log.debug(
      "AUTH",
      `${provider} | total connections: ${connections.length}, excludeIds: ${excludeSet.size > 0 ? [...excludeSet].join(",") : "none"}, model: ${model || "any"}`,
    );
    if (connections.length === 0) {
      log.warn("AUTH", `No credentials for ${provider}`);
      return null;
    }
    const availableConnections = connections.filter((c) => {
      if (excludeSet.has(c.id)) return false;
      if (isConnectionLockActive(c)) return false;
      if (isModelLockActive(c, model)) return false;
      return true;
    });
    log.debug("AUTH", `${provider} | available: ${availableConnections.length}/${connections.length}`);
    connections.forEach((c) => {
      const excluded = excludeSet.has(c.id);
      const connLocked = isConnectionLockActive(c);
      const locked = isModelLockActive(c, model);
      if (excluded || connLocked || locked) {
        const lockUntil = getConnectionLockUntil(c) || getEarliestModelLockUntil(c);
        log.debug(
          "AUTH",
          `  → ${c.id?.slice(0, 8)} | ${excluded ? "excluded" : ""} ${connLocked ? `connLocked until ${lockUntil}` : ""} ${locked ? `modelLocked(${model}) until ${lockUntil}` : ""}`,
        );
      }
    });
    if (availableConnections.length === 0) {
      const expiries = connections
        .map((c) => getConnectionLockUntil(c) || getEarliestModelLockUntil(c))
        .filter((x): x is string => Boolean(x));
      const earliest = expiries.sort()[0] || null;
      if (earliest) {
        const earliestConn = connections[0];
        log.warn(
          "AUTH",
          `${provider} | all ${connections.length} accounts locked for ${model || "all"} (${formatRetryAfter(earliest)}) | lastError=${earliestConn?.lastError?.slice(0, 50)}`,
        );
        return {
          allRateLimited: true,
          retryAfter: earliest,
          retryAfterHuman: formatRetryAfter(earliest),
          lastError: earliestConn?.lastError || null,
          lastErrorCode: earliestConn?.errorCode || null,
        };
      }
      log.warn("AUTH", `${provider} | all ${connections.length} accounts unavailable`);
      return null;
    }
    const settings = await getSettings();
    const providerOverride = (settings.providerStrategies || {})[providerId] || {};
    const strategy = providerOverride.fallbackStrategy || settings.fallbackStrategy || "fill-first";
    let connection: AnyConnection | undefined;
    if (preferredConnectionId) {
      connection = availableConnections.find((c) => c.id === preferredConnectionId);
      if (connection) {
        log.info(
          "AUTH",
          `${provider} | pinned to ${connection.id?.slice(0, 8)} (${connection.name || connection.email || "unnamed"})`,
        );
      }
    }
    if (connection) {
      // skip strategy
    } else if (strategy === "round-robin") {
      const stickyLimit = providerOverride.stickyRoundRobinLimit || settings.stickyRoundRobinLimit || 3;
      let state = rotationState.get(providerId);
      let current = state ? availableConnections.find((c) => c.id === state?.lastConnectionId) : null;
      if (!current) {
        const byRecency = [...availableConnections].sort((a, b) => {
          if (!a.lastUsedAt && !b.lastUsedAt) return (a.priority || 999) - (b.priority || 999);
          if (!a.lastUsedAt) return 1;
          if (!b.lastUsedAt) return -1;
          return new Date(b.lastUsedAt).getTime() - new Date(a.lastUsedAt).getTime();
        });
        current = byRecency[0];
        state = { lastConnectionId: current?.id, consecutiveCount: current?.consecutiveUseCount || 0 };
      }
      if (current && state.consecutiveCount < stickyLimit) {
        connection = current;
        state.consecutiveCount += 1;
      } else {
        const sortedByOldest = [...availableConnections].sort((a, b) => {
          if (!a.lastUsedAt && !b.lastUsedAt) return (a.priority || 999) - (b.priority || 999);
          if (!a.lastUsedAt) return -1;
          if (!b.lastUsedAt) return 1;
          return new Date(a.lastUsedAt).getTime() - new Date(b.lastUsedAt).getTime();
        });
        connection = sortedByOldest[0];
        state = { lastConnectionId: connection.id, consecutiveCount: 1 };
      }
      rotationState.set(providerId, state);
      schedulePersist(connection.id, {
        lastUsedAt: new Date().toISOString(),
        consecutiveUseCount: state.consecutiveCount,
      });
    } else {
      connection = availableConnections[0];
    }
    const resolvedProxy = await resolveConnectionProxyConfig(connection.providerSpecificData || {});
    return {
      apiKey: connection.apiKey,
      accessToken: connection.accessToken,
      refreshToken: connection.refreshToken,
      projectId: connection.projectId,
      connectionName: connection.displayName || connection.name || connection.email || connection.id,
      copilotToken: connection.providerSpecificData?.copilotToken,
      providerSpecificData: {
        ...(connection.providerSpecificData || {}),
        connectionProxyEnabled: resolvedProxy.connectionProxyEnabled,
        connectionProxyUrl: resolvedProxy.connectionProxyUrl,
        connectionNoProxy: resolvedProxy.connectionNoProxy,
        connectionProxyPoolId: resolvedProxy.proxyPoolId || null,
        vercelRelayUrl: resolvedProxy.vercelRelayUrl || "",
      },
      connectionId: connection.id,
      testStatus: connection.testStatus,
      lastError: connection.lastError,
      _connection: connection,
    };
  } catch (err) {
    log.error("AUTH", `getProviderCredentials failed: ${(err as { message?: string })?.message || err}`);
    throw err;
  }
}

export async function markAccountUnavailable(
  connectionId: string,
  status: number,
  errorText: string,
  provider: string | null = null,
  model: string | null = null,
  resetsAtMs: number | null = null,
): Promise<{ shouldFallback: boolean; cooldownMs: number }> {
  if (!connectionId || connectionId === "noauth") return { shouldFallback: false, cooldownMs: 0 };
  const connections = await getProviderConnections({ provider });
  const conn = (connections as AnyConnection[]).find((c) => c.id === connectionId);
  const backoffLevel = conn?.backoffLevel || 0;
  if (isConnectionLevelError(status, errorText)) {
    const { update, cooldownMs, newCount, until } = buildConnectionLockUpdate(conn, errorText);
    await updateProviderConnection(connectionId, update);
    if (provider) invalidateConnectionsCache(resolveProviderId(provider));
    const connName = conn?.displayName || conn?.name || conn?.email || connectionId.slice(0, 8);
    log.warn(
      "AUTH",
      `${connName} connection locked for ${Math.round(cooldownMs / 60000)}m (count=${newCount}, until=${until}) [${status}]`,
    );
    if (provider && status && errorText) {
      console.error("\u274C Connection lock triggered after authentication failure");
    }
    return { shouldFallback: true, cooldownMs };
  }
  let shouldFallback: boolean;
  let cooldownMs: number;
  let newBackoffLevel: number;
  if (resetsAtMs && resetsAtMs > Date.now()) {
    shouldFallback = true;
    cooldownMs = Math.min(resetsAtMs - Date.now(), MAX_RATE_LIMIT_COOLDOWN_MS);
    newBackoffLevel = 0;
  } else {
    ({ shouldFallback, cooldownMs, newBackoffLevel } = checkFallbackError(status, errorText, backoffLevel));
  }
  if (!shouldFallback) return { shouldFallback: false, cooldownMs: 0 };
  const settingsData = await getSettings().catch(() => ({}));
  const minimumLockoutMinutes = Number(settingsData.minimumLockoutMinutes) ?? 60;
  const minimumLockoutMs = Math.max(minimumLockoutMinutes, 0) * 60 * 1000;
  const prevLockCount = getModelLockCount(conn, model);
  const newLockCount = prevLockCount + 1;
  if (minimumLockoutMs > 0) {
    const effectiveMinimumMs = minimumLockoutMs * newLockCount;
    cooldownMs = Math.max(effectiveMinimumMs, cooldownMs);
  }
  const reason = typeof errorText === "string" ? errorText.slice(0, 100) : "Provider error";
  const lockUpdate = buildModelLockUpdate(model, cooldownMs);
  const lockKey = Object.keys(lockUpdate)[0];
  const existingExpiry = conn?.[lockKey];
  const newExpiry = Date.now() + cooldownMs;
  if (existingExpiry && new Date(existingExpiry).getTime() >= newExpiry - 5000) {
    return { shouldFallback: true, cooldownMs };
  }
  await updateProviderConnection(connectionId, {
    ...lockUpdate,
    [getModelLockCountKey(model)]: newLockCount,
    testStatus: "unavailable",
    lastError: reason,
    errorCode: status,
    lastErrorAt: new Date().toISOString(),
    backoffLevel: newBackoffLevel ?? backoffLevel,
  });
  if (provider) invalidateConnectionsCache(resolveProviderId(provider));
  const connName = conn?.displayName || conn?.name || conn?.email || connectionId.slice(0, 8);
  log.warn("AUTH", `${connName} locked ${lockKey} for ${Math.round(cooldownMs / 1000)}s [${status}]`);
  if (provider && status && reason) {
    console.error("❌ Provider request triggered a model lock");
  }
  return { shouldFallback: true, cooldownMs };
}

export async function clearAccountError(
  connectionId: string,
  currentConnection: AnyConnection,
  model: string | null = null,
): Promise<void> {
  if (!connectionId || connectionId === "noauth") return;
  const conn: AnyConnection = currentConnection._connection || currentConnection;
  const now = Date.now();
  const allLockKeys = Object.keys(conn).filter((k) => k.startsWith("modelLock_"));
  const allLockCountKeys = Object.keys(conn).filter((k) => k.startsWith(MODEL_LOCK_COUNT_PREFIX));
  const connLockUntil = conn[CONN_LOCK_UNTIL_KEY];
  const connLockExpired = connLockUntil && new Date(connLockUntil).getTime() <= now;
  if (!conn.testStatus && !conn.lastError && allLockKeys.length === 0 && !connLockExpired) return;
  const keysToClear = allLockKeys.filter((k) => {
    if (model && k === `modelLock_${model}`) return true;
    if (model && k === "modelLock___all") return true;
    const expiry = conn[k];
    return expiry && new Date(expiry).getTime() <= now;
  });
  if (keysToClear.length === 0 && conn.testStatus !== "unavailable" && !conn.lastError && !connLockExpired) return;
  const remainingActiveLocks = allLockKeys.filter((k) => {
    if (keysToClear.includes(k)) return false;
    const expiry = conn[k];
    return expiry && new Date(expiry).getTime() > now;
  });
  const clearObj: Record<string, unknown> = Object.fromEntries(keysToClear.map((k) => [k, null]));
  if (connLockExpired) {
    clearObj[CONN_LOCK_UNTIL_KEY] = null;
    clearObj[CONN_LOCK_COUNT_KEY] = null;
    clearObj[CONN_LOCK_REASON_KEY] = null;
  }
  const hasActiveConnLock = connLockUntil && !connLockExpired;
  if (remainingActiveLocks.length === 0 && !hasActiveConnLock) {
    Object.assign(clearObj, { testStatus: "active", lastError: null, lastErrorAt: null, backoffLevel: 0 });
    for (const k of allLockCountKeys) clearObj[k] = null;
  } else {
    const countKey = getModelLockCountKey(model);
    if (conn[countKey]) clearObj[countKey] = null;
  }
  await updateProviderConnection(connectionId, clearObj);
  if (conn?.provider) invalidateConnectionsCache(resolveProviderId(conn.provider));
}

export function extractApiKey(request: Request): string | null {
  const authHeader = request.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) return authHeader.slice(7);
  const xApiKey = request.headers.get("x-api-key");
  if (xApiKey) return xApiKey;
  return null;
}

export async function isValidApiKey(apiKey: string | null): Promise<boolean> {
  if (!apiKey) return false;
  return await validateApiKey(apiKey);
}
