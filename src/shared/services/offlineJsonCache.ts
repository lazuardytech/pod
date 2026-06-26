const DB_NAME = "pod-offline-json-cache";
const DB_VERSION = 2;
const STORE_NAME = "responses";
const TAG_INDEX_NAME = "cacheTags";

const DEFAULT_MAX_STALE_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

let openDbPromise: Promise<IDBDatabase | null> | null = null;
let idbDisabled = false;

type IdbRequest = IDBRequest<unknown>;
type IdbTx = IDBTransaction;

function supportsIndexedDb(): boolean {
  return typeof window !== "undefined" && typeof window.indexedDB !== "undefined" && !idbDisabled;
}

function requestToPromise<T = unknown>(request: IdbRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result as T);
    request.onerror = () => reject(request.error || new Error("IndexedDB request failed"));
  });
}

function transactionDone(transaction: IdbTx): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("IndexedDB transaction failed"));
    transaction.onabort = () => reject(transaction.error || new Error("IndexedDB transaction aborted"));
  });
}

type CacheRecord = {
  cacheKey: string;
  url?: string;
  data: unknown;
  updatedAt: number;
  invalidatedAt?: number;
  cacheTags?: string[];
  etag?: string;
  lastModified?: string;
};

async function getDb(): Promise<IDBDatabase | null> {
  if (!supportsIndexedDb()) return null;
  if (openDbPromise) return openDbPromise;

  openDbPromise = new Promise((resolve) => {
    let req: IDBOpenDBRequest;
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
        const store = db.createObjectStore(STORE_NAME, { keyPath: "cacheKey" });
        store.createIndex(TAG_INDEX_NAME, "cacheTags", { unique: false, multiEntry: true });
        return;
      }

      const store = req.transaction?.objectStore(STORE_NAME);
      if (store && !store.indexNames.contains(TAG_INDEX_NAME)) {
        store.createIndex(TAG_INDEX_NAME, "cacheTags", { unique: false, multiEntry: true });
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
      openDbPromise = null;
      resolve(null);
    };
  });

  return openDbPromise;
}

function normalizeMaxStale(maxStaleMs: number): number {
  if (!Number.isFinite(maxStaleMs) || maxStaleMs <= 0) return DEFAULT_MAX_STALE_MS;
  return maxStaleMs;
}

function normalizeCacheTags(cacheTags: unknown = []): string[] {
  if (!Array.isArray(cacheTags)) return [];
  return [...new Set(cacheTags.map((tag) => String(tag || "").trim()).filter(Boolean))];
}

function normalizeCacheKeys(cacheKeys: unknown = []): string[] {
  if (!Array.isArray(cacheKeys)) return [];
  return [...new Set(cacheKeys.map((cacheKey) => String(cacheKey || "").trim()).filter(Boolean))];
}

function buildConditionalHeaders(existingHeaders: HeadersInit | undefined, record: CacheRecord | null): Headers {
  const headers = new Headers(existingHeaders || {});

  if (record?.etag && !headers.has("If-None-Match")) {
    headers.set("If-None-Match", record.etag);
  }
  if (record?.lastModified && !headers.has("If-Modified-Since")) {
    headers.set("If-Modified-Since", record.lastModified);
  }

  return headers;
}

function dispatchOfflineCacheEvent(type: string, detail: Record<string, unknown> = {}): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(type, { detail }));
}

async function getCacheRecord(cacheKey: string): Promise<CacheRecord | null> {
  if (!cacheKey) return null;
  const db = await getDb();
  if (!db) return null;

  try {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const record = (await requestToPromise(store.get(cacheKey))) as CacheRecord | undefined;
    await transactionDone(tx);
    return record || null;
  } catch {
    return null;
  }
}

export type WriteOfflineJsonCacheOptions = {
  url?: string;
  cacheTags?: string[];
  etag?: string;
  lastModified?: string;
};

export async function writeOfflineJsonCache(
  cacheKey: string,
  data: unknown,
  { url = "", cacheTags = [], etag = "", lastModified = "" }: WriteOfflineJsonCacheOptions = {},
): Promise<boolean> {
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
      invalidatedAt: 0,
      cacheTags: normalizeCacheTags(cacheTags),
      etag: etag || "",
      lastModified: lastModified || "",
    });
    await transactionDone(tx);
    return true;
  } catch {
    return false;
  }
}

type TouchMetadata = { etag?: string; lastModified?: string };

async function touchOfflineJsonCache(cacheKey: string, metadata: TouchMetadata = {}): Promise<boolean> {
  if (!cacheKey) return false;
  const db = await getDb();
  if (!db) return false;

  try {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const existing = (await requestToPromise(store.get(cacheKey))) as CacheRecord | undefined;
    if (!existing) {
      await transactionDone(tx);
      return false;
    }

    store.put({
      ...existing,
      updatedAt: Date.now(),
      invalidatedAt: 0,
      etag: metadata.etag || existing.etag || "",
      lastModified: metadata.lastModified || existing.lastModified || "",
      cacheTags: normalizeCacheTags(existing.cacheTags),
    });
    await transactionDone(tx);
    return true;
  } catch {
    return false;
  }
}

export type ReadOfflineJsonCacheResult = {
  data: unknown;
  updatedAt: number;
  ageMs: number;
  expired: boolean;
  invalidated: boolean;
  invalidatedAt: number;
  cacheTags: string[];
};

export async function readOfflineJsonCache(
  cacheKey: string,
  { maxStaleMs = DEFAULT_MAX_STALE_MS }: { maxStaleMs?: number } = {},
): Promise<ReadOfflineJsonCacheResult | null> {
  const record = await getCacheRecord(cacheKey);
  if (!record) return null;

  const updatedAt = Number(record.updatedAt || 0);
  if (!Number.isFinite(updatedAt) || updatedAt <= 0) return null;

  const ageMs = Date.now() - updatedAt;
  const normalizedMaxStaleMs = normalizeMaxStale(maxStaleMs);
  const expired = ageMs > normalizedMaxStaleMs;
  const invalidatedAt = Number(record.invalidatedAt || 0);
  const invalidated = Number.isFinite(invalidatedAt) && invalidatedAt > updatedAt;

  return {
    data: record.data,
    updatedAt,
    ageMs,
    expired,
    invalidated,
    invalidatedAt: invalidated ? invalidatedAt : 0,
    cacheTags: normalizeCacheTags(record.cacheTags),
  };
}

export type InvalidateOfflineJsonCacheOptions = {
  cacheKeys?: string[];
  cacheTags?: string[];
};

export async function invalidateOfflineJsonCache({
  cacheKeys = [],
  cacheTags = [],
}: InvalidateOfflineJsonCacheOptions = {}): Promise<{ invalidated: number }> {
  const normalizedKeys = normalizeCacheKeys(cacheKeys);
  const normalizedTags = normalizeCacheTags(cacheTags);
  if (normalizedKeys.length === 0 && normalizedTags.length === 0) return { invalidated: 0 };

  const db = await getDb();
  if (!db) return { invalidated: 0 };

  const now = Date.now();
  let invalidated = 0;

  try {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const matchByKey = new Set(normalizedKeys);
    const matchByTag = new Set(normalizedTags);

    await new Promise<void>((resolve) => {
      const req = store.openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) {
          resolve();
          return;
        }

        const value = cursor.value as CacheRecord;
        const tags = normalizeCacheTags(value?.cacheTags);
        const shouldInvalidate =
          matchByKey.has(String(value?.cacheKey || "")) || tags.some((tag) => matchByTag.has(tag));

        if (shouldInvalidate) {
          cursor.update({
            ...value,
            invalidatedAt: now,
            cacheTags: tags,
          });
          invalidated += 1;
        }

        cursor.continue();
      };
      req.onerror = () => resolve();
    });

    await transactionDone(tx);

    if (invalidated > 0) {
      dispatchOfflineCacheEvent("pod:offline-json-cache-invalidated", {
        cacheKeys: normalizedKeys,
        cacheTags: normalizedTags,
        invalidated,
      });
    }

    return { invalidated };
  } catch {
    return { invalidated: 0 };
  }
}

export type FetchJsonAndCacheOptions = {
  cacheKey?: string;
  fetchOptions?: RequestInit;
  cacheTags?: string[];
};

export async function fetchJsonAndCache(
  url: string,
  { cacheKey = url, fetchOptions, cacheTags = [] }: FetchJsonAndCacheOptions = {},
): Promise<unknown> {
  const existingRecord = await getCacheRecord(cacheKey);
  const headers = buildConditionalHeaders(fetchOptions?.headers, existingRecord);
  const response = await fetch(url, {
    ...(fetchOptions || {}),
    headers,
  });

  if (response.status === 304 && existingRecord) {
    await touchOfflineJsonCache(cacheKey, {
      etag: response.headers.get("ETag") || existingRecord.etag || "",
      lastModified: response.headers.get("Last-Modified") || existingRecord.lastModified || "",
    });
    return existingRecord.data;
  }

  if (!response.ok) {
    const message = `Request failed with status ${response.status}`;
    const error = new Error(message) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }

  const data = await response.json();
  await writeOfflineJsonCache(cacheKey, data, {
    url,
    cacheTags,
    etag: response.headers.get("ETag") || "",
    lastModified: response.headers.get("Last-Modified") || "",
  });
  return data;
}

export type LoadJsonStaleWhileRevalidateOptions = {
  url?: string;
  cacheKey?: string;
  maxStaleMs?: number;
  fetchOptions?: RequestInit;
  cacheTags?: string[];
  onCacheData?: (data: unknown, info: { stale: boolean; ageMs: number; updatedAt: number }) => void;
  onFreshData?: (data: unknown, info: { stale: boolean; ageMs: number; updatedAt: number }) => void;
};

export type LoadJsonStaleWhileRevalidateResult =
  | { data: unknown; source: "none"; stale: false }
  | { data: unknown; source: "network"; stale: false }
  | { data: unknown; source: "cache"; stale: true; invalidated: boolean; error: unknown };

export async function loadJsonStaleWhileRevalidate({
  url,
  cacheKey = url,
  maxStaleMs = DEFAULT_MAX_STALE_MS,
  fetchOptions,
  cacheTags = [],
  onCacheData,
  onFreshData,
}: LoadJsonStaleWhileRevalidateOptions = {}): Promise<LoadJsonStaleWhileRevalidateResult> {
  if (!url) return { data: null, source: "none", stale: false };

  const cached = await readOfflineJsonCache(cacheKey, { maxStaleMs });
  const hasUsableCache = cached && !cached.expired;

  if (hasUsableCache && typeof onCacheData === "function") {
    onCacheData(cached.data, { stale: true, ageMs: cached.ageMs, updatedAt: cached.updatedAt });
  }

  try {
    const fresh = await fetchJsonAndCache(url, { cacheKey, fetchOptions, cacheTags });
    if (typeof onFreshData === "function") {
      onFreshData(fresh, { stale: false, ageMs: 0, updatedAt: Date.now() });
    }
    return { data: fresh, source: "network", stale: false };
  } catch (error) {
    if (hasUsableCache) {
      return { data: cached.data, source: "cache", stale: true, invalidated: cached.invalidated, error };
    }
    throw error;
  }
}
