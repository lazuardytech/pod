import {
  BACKOFF_CONFIG,
  ERROR_RULES,
  msUntilMidnightVN,
  msUntilNextMinute,
  TRANSIENT_COOLDOWN_MS,
} from "../config/errorConfig.js";

/**
 * Calculate exponential backoff cooldown for rate limits (429)
 * Level 1: 1s, Level 2: 2s, Level 3: 4s... → max 4 min
 * @param {number} backoffLevel - Current backoff level
 * @returns {number} Cooldown in milliseconds
 */
export function getQuotaCooldown(backoffLevel: any = 0) {
  const level = Math.max(0, backoffLevel - 1);
  const cooldown = BACKOFF_CONFIG.base * 2 ** level;
  return Math.min(cooldown, BACKOFF_CONFIG.max);
}

/**
 * Check if error should trigger account fallback (switch to next account)
 * Config-driven: matches ERROR_RULES top-to-bottom (text rules first, then status)
 * @param {number} status - HTTP status code
 * @param {string} errorText - Error message text
 * @param {number} backoffLevel - Current backoff level for exponential backoff
 * @returns {{ shouldFallback: boolean, cooldownMs: number, newBackoffLevel?: number }}
 */
export function checkFallbackError(status: any, errorText: any, backoffLevel: any = 0) {
  const lowerError = errorText
    ? (typeof errorText === "string" ? errorText : JSON.stringify(errorText)).toLowerCase()
    : "";

  const resolveCooldown = (rule: any) => {
    if (rule.backoff) {
      const newLevel = Math.min(backoffLevel + 1, BACKOFF_CONFIG.maxLevel);
      return {
        shouldFallback: true,
        cooldownMs: getQuotaCooldown(newLevel),
        newBackoffLevel: newLevel,
      };
    }
    if (rule.untilMidnightVN) {
      return { shouldFallback: true, cooldownMs: msUntilMidnightVN(), newBackoffLevel: 0 };
    }
    if (rule.untilNextMinute) {
      return { shouldFallback: true, cooldownMs: msUntilNextMinute(), newBackoffLevel: 0 };
    }
    return { shouldFallback: true, cooldownMs: rule.cooldownMs };
  };

  const rawError = errorText
    ? typeof errorText === "string"
      ? errorText
      : JSON.stringify(errorText)
    : "";

  for (const rule of ERROR_RULES) {
    if (rule.text && lowerError && lowerError.includes(rule.text)) return resolveCooldown(rule);
    if (rule.pattern && rawError && rule.pattern.test(rawError)) return resolveCooldown(rule);
    if (rule.status && rule.status === status) return resolveCooldown(rule);
  }

  // Default: transient cooldown for any unmatched error
  return { shouldFallback: true, cooldownMs: TRANSIENT_COOLDOWN_MS };
}

/**
 * Check if account is currently unavailable (cooldown not expired)
 */
export function isAccountUnavailable(unavailableUntil: any) {
  if (!unavailableUntil) return false;
  return new Date(unavailableUntil).getTime() > Date.now();
}

/**
 * Calculate unavailable until timestamp
 */
export function getUnavailableUntil(cooldownMs: any) {
  return new Date(Date.now() + cooldownMs).toISOString();
}

/**
 * Get the earliest rateLimitedUntil from a list of accounts
 * @param {Array} accounts - Array of account objects with rateLimitedUntil
 * @returns {string|null} Earliest rateLimitedUntil ISO string, or null
 */
export function getEarliestRateLimitedUntil(accounts: any) {
  let earliest = null;
  const now = Date.now();
  for (const acc of accounts) {
    if (!acc.rateLimitedUntil) continue;
    const until = new Date(acc.rateLimitedUntil).getTime();
    if (until <= now) continue;
    if (!earliest || until < earliest) earliest = until;
  }
  if (!earliest) return null;
  return new Date(earliest).toISOString();
}

/**
 * Format rateLimitedUntil to human-readable "reset after Xm Ys"
 * @param {string} rateLimitedUntil - ISO timestamp
 * @returns {string} e.g. "reset after 2m 30s"
 */
export function formatRetryAfter(rateLimitedUntil: any) {
  if (!rateLimitedUntil) return "";
  const diffMs = new Date(rateLimitedUntil).getTime() - Date.now();
  if (diffMs <= 0) return "reset after 0s";
  const totalSec = Math.ceil(diffMs / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const parts = [];
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  if (s > 0 || parts.length === 0) parts.push(`${s}s`);
  return `reset after ${parts.join(" ")}`;
}

// ---------------------------------------------------------------------------
// Connection-level lock (account-wide, not per-model)
// ---------------------------------------------------------------------------

/**
 * Keys used for connection-level lockdown.
 * Unlike model locks (per model per connection), connection locks apply to
 * the entire connection regardless of which model is requested.
 * Triggered by account-level errors: suspicious activity, auth failure, etc.
 */
export const CONN_LOCK_UNTIL_KEY = "connectionLockUntil";
export const CONN_LOCK_COUNT_KEY = "connectionLockCount";
export const CONN_LOCK_REASON_KEY = "connectionLockReason";

/** Base cooldown for connection-level lock: 1 hour */
export const CONN_LOCK_BASE_MS = 60 * 60 * 1000;

/**
 * Patterns that indicate a connection-level (account-wide) error,
 * not a model-specific quota error.
 * When matched, the entire connection is locked (not just one model).
 */
const CONN_LEVEL_ERROR_PATTERNS = [
  /suspicious activity/i,
  /temporary limit/i,
  /temporarily limit/i,
  /account.*suspend/i,
  /account.*block/i,
  /account.*restrict/i,
  /account.*ban/i,
  /your account/i,
  /this account/i,
];

/**
 * Returns true when the error is account-wide (connection-level),
 * not model-specific. These errors should lock the entire connection
 * so the retry loop immediately moves to the next account.
 */
export function isConnectionLevelError(status: any, bodyText: any) {
  // 401/403 = auth failure — always connection-level
  if (status === 401 || status === 403) return true;
  if (!bodyText) return false;
  const text = typeof bodyText === "string" ? bodyText : JSON.stringify(bodyText);
  return CONN_LEVEL_ERROR_PATTERNS.some((re: any) => re.test(text));
}

/**
 * Check if a connection-level lock is currently active.
 */
export function isConnectionLockActive(connection: any) {
  const until = connection?.[CONN_LOCK_UNTIL_KEY] || connection?.data?.[CONN_LOCK_UNTIL_KEY];
  if (!until) return false;
  return new Date(until).getTime() > Date.now();
}

/**
 * Get connection lock expiry (ISO string) or null.
 */
export function getConnectionLockUntil(connection: any) {
  const until = connection?.[CONN_LOCK_UNTIL_KEY] || connection?.data?.[CONN_LOCK_UNTIL_KEY];
  if (!until) return null;
  return new Date(until).getTime() > Date.now() ? until : null;
}

/**
 * Build update object to set a connection-level lock.
 * Cooldown = base * lockCount (1h, 2h, 3h, ...)
 */
export function buildConnectionLockUpdate(connection: any, reason: any) {
  const prevCount = Number(
    connection?.[CONN_LOCK_COUNT_KEY] || connection?.data?.[CONN_LOCK_COUNT_KEY] || 0,
  );
  const newCount = prevCount + 1;
  const cooldownMs = CONN_LOCK_BASE_MS * newCount;
  const until = new Date(Date.now() + cooldownMs).toISOString();
  return {
    update: {
      [CONN_LOCK_UNTIL_KEY]: until,
      [CONN_LOCK_COUNT_KEY]: newCount,
      [CONN_LOCK_REASON_KEY]:
        typeof reason === "string" ? reason.slice(0, 200) : "Connection error",
      testStatus: "unavailable",
      lastError: typeof reason === "string" ? reason.slice(0, 100) : "Connection error",
      lastErrorAt: new Date().toISOString(),
    },
    cooldownMs,
    newCount,
    until,
  };
}

/**
 * Build update object to clear a connection-level lock.
 */
export function buildClearConnectionLockUpdate() {
  return {
    [CONN_LOCK_UNTIL_KEY]: null,
    [CONN_LOCK_COUNT_KEY]: null,
    [CONN_LOCK_REASON_KEY]: null,
  };
}

// ---------------------------------------------------------------------------

/** Prefix for model lock flat fields on connection record */
export const MODEL_LOCK_PREFIX = "modelLock_";

/** Special key used when no model is known (account-level lock) */
export const MODEL_LOCK_ALL = `${MODEL_LOCK_PREFIX}__all`;

/** Build the flat field key for a model lock */
export function getModelLockKey(model: any) {
  return model ? `${MODEL_LOCK_PREFIX}${model}` : MODEL_LOCK_ALL;
}

/** Prefix for model lock count flat fields — tracks how many times a model has been locked */
export const MODEL_LOCK_COUNT_PREFIX = "modelLockCount_";

/** Build the flat field key for a model lock count */
export function getModelLockCountKey(model: any) {
  return model ? `${MODEL_LOCK_COUNT_PREFIX}${model}` : `${MODEL_LOCK_COUNT_PREFIX}__all`;
}

/** Read current lock count for a model from a connection record */
export function getModelLockCount(connection: any, model: any) {
  const key = getModelLockCountKey(model);
  return Number(connection?.[key]) || 0;
}

/**
 * Check if a model lock on a connection is still active.
 * Reads flat field `modelLock_${model}` (or `modelLock___all` when model=null).
 */
export function isModelLockActive(connection: any, model: any) {
  const key = getModelLockKey(model);
  const expiry = connection[key] || connection[MODEL_LOCK_ALL];
  if (!expiry) return false;
  return new Date(expiry).getTime() > Date.now();
}

/**
 * Get earliest active model lock expiry across all modelLock_* fields.
 * Used for UI cooldown display.
 */
export function getEarliestModelLockUntil(connection: any) {
  if (!connection) return null;
  let earliest = null;
  const now = Date.now();
  for (const [key, val] of Object.entries(connection)) {
    if (!key.startsWith(MODEL_LOCK_PREFIX) || !val) continue;
    const t = new Date(val).getTime();
    if (t <= now) continue;
    if (!earliest || t < earliest) earliest = t;
  }
  return earliest ? new Date(earliest).toISOString() : null;
}

/**
 * Build update object to set a model lock on a connection.
 */
export function buildModelLockUpdate(model: any, cooldownMs: any) {
  const key = getModelLockKey(model);
  return { [key]: new Date(Date.now() + cooldownMs).toISOString() };
}

/**
 * Build update object to clear all model locks on a connection.
 */
export function buildClearModelLocksUpdate(connection: any) {
  const cleared = {};
  for (const key of Object.keys(connection)) {
    if (key.startsWith(MODEL_LOCK_PREFIX)) cleared[key] = null;
    if (key.startsWith(MODEL_LOCK_COUNT_PREFIX)) cleared[key] = null;
  }
  return cleared;
}

/**
 * Filter available accounts (not in cooldown)
 */
export function filterAvailableAccounts(accounts: any, excludeId: any = null) {
  const now = Date.now();
  return accounts.filter((acc: any) => {
    if (excludeId && acc.id === excludeId) return false;
    if (acc.rateLimitedUntil) {
      const until = new Date(acc.rateLimitedUntil).getTime();
      if (until > now) return false;
    }
    return true;
  });
}

/**
 * Reset account state when request succeeds
 * Clears cooldown and resets backoff level to 0
 * @param {object} account - Account object
 * @returns {object} Updated account with reset state
 */
export function resetAccountState(account: any) {
  if (!account) return account;
  return {
    ...account,
    rateLimitedUntil: null,
    backoffLevel: 0,
    lastError: null,
    status: "active",
  };
}

/**
 * Apply error state to account
 * @param {object} account - Account object
 * @param {number} status - HTTP status code
 * @param {string} errorText - Error message
 * @returns {object} Updated account with error state
 */
export function applyErrorState(account: any, status: any, errorText: any) {
  if (!account) return account;

  const backoffLevel = account.backoffLevel || 0;
  const { cooldownMs, newBackoffLevel } = checkFallbackError(status, errorText, backoffLevel);

  return {
    ...account,
    rateLimitedUntil: cooldownMs > 0 ? getUnavailableUntil(cooldownMs) : null,
    backoffLevel: newBackoffLevel ?? backoffLevel,
    lastError: { status, message: errorText, timestamp: new Date().toISOString() },
    status: "error",
  };
}
