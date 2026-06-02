const DB_NAME = "pod-offline-json-cache";
const DB_VERSION = 1;
const STORE_NAME = "responses";

const DEFAULT_MAX_STALE_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

let openDbPromise = null;
let idbDisabled = false;

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
        db.createObjectStore(STORE_NAME, { keyPath: "cacheKey" });
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
      resolve(null);
    };
  });

  return openDbPromise;
}

function normalizeMaxStale(maxStaleMs) {
  if (!Number.isFinite(maxStaleMs) || maxStaleMs <= 0) return DEFAULT_MAX_STALE_MS;
  return maxStaleMs;
}

async function getCacheRecord(cacheKey) {
  if (!cacheKey) return null;
  const db = await getDb();
  if (!db) return null;

  try {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const record = await requestToPromise(store.get(cacheKey));
    await transactionDone(tx);
    return record || null;
  } catch {
    return null;
  }
}

export async function writeOfflineJsonCache(cacheKey, data, { url = "" } = {}) {
  if (!cacheKey || data === undefined) return false;
  const db = await getDb();
  if (!db) return false;

  try {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    store.put({
      cacheKey,
      url,
      data,
      updatedAt: Date.now(),
    });
    await transactionDone(tx);
    return true;
  } catch {
    return false;
  }
}

export async function readOfflineJsonCache(cacheKey, { maxStaleMs = DEFAULT_MAX_STALE_MS } = {}) {
  const record = await getCacheRecord(cacheKey);
  if (!record) return null;

  const updatedAt = Number(record.updatedAt || 0);
  if (!Number.isFinite(updatedAt) || updatedAt <= 0) return null;

  const ageMs = Date.now() - updatedAt;
  const normalizedMaxStaleMs = normalizeMaxStale(maxStaleMs);
  const expired = ageMs > normalizedMaxStaleMs;

  return {
    data: record.data,
    updatedAt,
    ageMs,
    expired,
  };
}

export async function fetchJsonAndCache(url, { cacheKey = url, fetchOptions } = {}) {
  const response = await fetch(url, fetchOptions);
  if (!response.ok) {
    const message = `Request failed with status ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }

  const data = await response.json();
  await writeOfflineJsonCache(cacheKey, data, { url });
  return data;
}

export async function loadJsonStaleWhileRevalidate({
  url,
  cacheKey = url,
  maxStaleMs = DEFAULT_MAX_STALE_MS,
  fetchOptions,
  onCacheData,
  onFreshData,
} = {}) {
  if (!url) return { data: null, source: "none", stale: false };

  const cached = await readOfflineJsonCache(cacheKey, { maxStaleMs });
  const hasUsableCache = cached && !cached.expired;

  if (hasUsableCache && typeof onCacheData === "function") {
    onCacheData(cached.data, { stale: true, ageMs: cached.ageMs, updatedAt: cached.updatedAt });
  }

  try {
    const fresh = await fetchJsonAndCache(url, { cacheKey, fetchOptions });
    if (typeof onFreshData === "function") {
      onFreshData(fresh, { stale: false, ageMs: 0, updatedAt: Date.now() });
    }
    return { data: fresh, source: "network", stale: false };
  } catch (error) {
    if (hasUsableCache) {
      return { data: cached.data, source: "cache", stale: true, error };
    }
    throw error;
  }
}
