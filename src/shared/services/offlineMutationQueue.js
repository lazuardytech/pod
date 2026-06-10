import { invalidateOfflineJsonCache } from "@/shared/services/offlineJsonCache";

const DB_NAME = "pod-offline-mutation-queue";
const DB_VERSION = 1;
const STORE_NAME = "mutations";

const MAX_RETRY_DELAY_MS = 1000 * 60 * 15;
const MAX_ATTEMPTS = 12;

let openDbPromise = null;
let idbDisabled = false;
let drainingPromise = null;

function supportsIndexedDb() {
  return typeof window !== "undefined" && typeof window.indexedDB !== "undefined" && !idbDisabled;
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB request failed"));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("IndexedDB transaction failed"));
    transaction.onabort = () => reject(transaction.error || new Error("IndexedDB transaction aborted"));
  });
}

async function getDb() {
  if (!supportsIndexedDb()) return null;
  if (openDbPromise) return openDbPromise;

  openDbPromise = new Promise((resolve) => {
    let req;
    try {
      req = window.indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      idbDisabled = true;
      resolve(null);
      return;
    }

    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id", autoIncrement: true });
        store.createIndex("nextAttemptAt", "nextAttemptAt", { unique: false });
      }
    };

    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };

    req.onerror = () => {
      idbDisabled = true;
      resolve(null);
    };

    req.onblocked = () => {
      // Another tab holds a higher DB version — not our problem, that tab\n      // will eventually close. Fail this open so next call retries.
      openDbPromise = null;
      resolve(null);
    };
  });

  return openDbPromise;
}

function normalizeMethod(method) {
  if (!method) return "POST";
  return String(method).toUpperCase();
}

function normalizeHeaders(headers = {}) {
  if (!headers || typeof headers !== "object") return {};
  return Object.fromEntries(
    Object.entries(headers).map(([k, v]) => [String(k), typeof v === "string" ? v : v == null ? "" : String(v)]),
  );
}

function buildBackoffMs(attempts) {
  const exp = Math.max(0, attempts - 1);
  return Math.min(MAX_RETRY_DELAY_MS, 1000 * 2 ** exp);
}

function safeSerializeBody(body) {
  if (body == null) return null;
  if (typeof body === "string") return body;
  if (
    typeof body === "object" &&
    !Array.isArray(body) &&
    !(body instanceof FormData) &&
    !(body instanceof Blob) &&
    !(body instanceof ArrayBuffer)
  ) {
    try {
      return JSON.stringify(body);
    } catch {
      return null;
    }
  }
  return null; // unsupported type — caller gets { ok: false, reason: "unsupported_body_type" }
}

function canReplayNow(item, nowMs = Date.now()) {
  return Number(item?.nextAttemptAt || 0) <= nowMs;
}

function shouldRetryStatus(status) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

async function listQueueItems(limit = 50) {
  const db = await getDb();
  if (!db) return [];

  const maxItems = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 50;
  const tx = db.transaction(STORE_NAME, "readonly");
  const store = tx.objectStore(STORE_NAME);

  const items = await new Promise((resolve) => {
    const out = [];
    const req = store.openCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor || out.length >= maxItems) {
        resolve(out);
        return;
      }
      out.push(cursor.value);
      cursor.continue();
    };
    req.onerror = () => resolve(out);
  });

  await transactionDone(tx).catch(() => {});
  return items;
}

async function deleteQueueItem(id) {
  const db = await getDb();
  if (!db || !Number.isFinite(Number(id))) return false;

  try {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(Number(id));
    await transactionDone(tx);
    return true;
  } catch {
    return false;
  }
}

async function updateQueueItem(id, updater) {
  const db = await getDb();
  if (!db || !Number.isFinite(Number(id))) return false;

  try {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const existing = await requestToPromise(store.get(Number(id)));
    if (!existing) {
      await transactionDone(tx);
      return false;
    }
    const nextValue = typeof updater === "function" ? updater(existing) : updater;
    if (!nextValue) {
      await transactionDone(tx);
      return false;
    }
    store.put(nextValue);
    await transactionDone(tx);
    return true;
  } catch {
    return false;
  }
}

async function dispatchQueueEvent(type, detail = {}) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(type, { detail }));
}

export async function getOfflineMutationQueueLength() {
  const db = await getDb();
  if (!db) return 0;

  try {
    const tx = db.transaction(STORE_NAME, "readonly");
    const count = await requestToPromise(tx.objectStore(STORE_NAME).count());
    await transactionDone(tx);
    return Number(count || 0);
  } catch {
    return 0;
  }
}

export async function enqueueOfflineMutation({ url, method = "POST", headers = {}, body = undefined, meta = {} } = {}) {
  if (!url) return { ok: false, reason: "missing_url" };
  const db = await getDb();
  if (!db) return { ok: false, reason: "idb_unavailable" };

  const normalizedMethod = normalizeMethod(method);
  const normalizedHeaders = normalizeHeaders(headers);
  const now = Date.now();

  const record = {
    url,
    method: normalizedMethod,
    headers: normalizedHeaders,
    body: safeSerializeBody(body),
    createdAt: now,
    attempts: 0,
    nextAttemptAt: now,
    lastError: "",
    meta: meta && typeof meta === "object" ? meta : {},
  };

  try {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const id = await requestToPromise(tx.objectStore(STORE_NAME).add(record));
    await transactionDone(tx);
    const queueLength = await getOfflineMutationQueueLength();
    await dispatchQueueEvent("pod:offline-mutation-enqueued", { id, queueLength, method: normalizedMethod, url });
    return { ok: true, id, queueLength };
  } catch {
    return { ok: false, reason: "write_failed" };
  }
}

async function replayMutation(item) {
  const method = normalizeMethod(item?.method);
  const init = {
    method,
    headers: normalizeHeaders(item?.headers || {}),
  };

  if (method !== "GET" && method !== "HEAD" && item?.body != null) {
    init.body = typeof item.body === "string" ? item.body : String(item.body);
  }

  try {
    const response = await fetch(item.url, init);
    if (response.ok) {
      return { status: "success", code: response.status };
    }
    if (shouldRetryStatus(response.status)) {
      return { status: "retry", code: response.status, error: `HTTP ${response.status}` };
    }
    return { status: "drop", code: response.status, error: `HTTP ${response.status}` };
  } catch (error) {
    return { status: "retry", error: error?.message || "Network error" };
  }
}

export async function drainOfflineMutationQueue({ limit = 25 } = {}) {
  if (drainingPromise) return drainingPromise;

  drainingPromise = (async () => {
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      return { processed: 0, succeeded: 0, retried: 0, dropped: 0, remaining: await getOfflineMutationQueueLength() };
    }

    const queue = await listQueueItems(limit);
    let processed = 0;
    let succeeded = 0;
    let retried = 0;
    let dropped = 0;
    const now = Date.now();

    for (const item of queue) {
      if (!item?.id) continue;
      if (!canReplayNow(item, now)) continue;
      processed += 1;

      const outcome = await replayMutation(item);

      if (outcome.status === "success") {
        await invalidateOfflineJsonCache({
          cacheKeys: item?.meta?.invalidateCacheKeys,
          cacheTags: item?.meta?.invalidateCacheTags,
        });
        await deleteQueueItem(item.id);
        succeeded += 1;
        continue;
      }

      const nextAttempts = Number(item.attempts || 0) + 1;
      const exhausted = nextAttempts >= MAX_ATTEMPTS;
      if (outcome.status === "drop" || exhausted) {
        await deleteQueueItem(item.id);
        dropped += 1;
        continue;
      }

      const delayMs = buildBackoffMs(nextAttempts);
      await updateQueueItem(item.id, (existing) => ({
        ...existing,
        attempts: nextAttempts,
        lastError: outcome.error || "Retry scheduled",
        nextAttemptAt: Date.now() + delayMs,
      }));
      retried += 1;
    }

    const remaining = await getOfflineMutationQueueLength();
    if (processed > 0 || succeeded > 0 || retried > 0 || dropped > 0) {
      await dispatchQueueEvent("pod:offline-mutation-drain", { processed, succeeded, retried, dropped, remaining });
    }

    return { processed, succeeded, retried, dropped, remaining };
  })();

  try {
    return await drainingPromise;
  } finally {
    drainingPromise = null;
  }
}
