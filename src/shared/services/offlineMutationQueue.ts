import { invalidateOfflineJsonCache } from "@/shared/services/offlineJsonCache";

const DB_NAME = "pod-offline-mutation-queue";
const DB_VERSION = 1;
const STORE_NAME = "mutations";

const MAX_RETRY_DELAY_MS = 1000 * 60 * 15;
const MAX_ATTEMPTS = 12;

type IdbRequest = IDBRequest<unknown>;
type IdbTx = IDBTransaction;

let openDbPromise: Promise<IDBDatabase | null> | null = null;
let idbDisabled = false;
let drainingPromise: Promise<DrainResult> | null = null;

type MutationRecord = {
  id?: number;
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
  createdAt: number;
  attempts: number;
  nextAttemptAt: number;
  lastError: string;
  meta: Record<string, unknown>;
};

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
      // Another tab holds a higher DB version — not our problem, that tab
      // will eventually close. Fail this open so next call retries.
      openDbPromise = null;
      resolve(null);
    };
  });

  return openDbPromise;
}

function normalizeMethod(method: unknown): string {
  if (!method) return "POST";
  return String(method).toUpperCase();
}

function normalizeHeaders(headers: Record<string, unknown> = {}): Record<string, string> {
  if (!headers || typeof headers !== "object") return {};
  return Object.fromEntries(
    Object.entries(headers).map(([k, v]) => [String(k), typeof v === "string" ? v : v == null ? "" : String(v)]),
  );
}

function buildBackoffMs(attempts: number): number {
  const exp = Math.max(0, attempts - 1);
  return Math.min(MAX_RETRY_DELAY_MS, 1000 * 2 ** exp);
}

function safeSerializeBody(body: unknown): string | null {
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

function canReplayNow(item: MutationRecord | null | undefined, nowMs: number = Date.now()): boolean {
  return Number(item?.nextAttemptAt || 0) <= nowMs;
}

function shouldRetryStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

async function listQueueItems(limit: number = 50): Promise<MutationRecord[]> {
  const db = await getDb();
  if (!db) return [];

  const maxItems = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 50;
  const tx = db.transaction(STORE_NAME, "readonly");
  const store = tx.objectStore(STORE_NAME);

  const items = await new Promise<MutationRecord[]>((resolve) => {
    const out: MutationRecord[] = [];
    const req = store.openCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor || out.length >= maxItems) {
        resolve(out);
        return;
      }
      out.push(cursor.value as MutationRecord);
      cursor.continue();
    };
    req.onerror = () => resolve(out);
  });

  await transactionDone(tx).catch(() => {});
  return items;
}

async function deleteQueueItem(id: number): Promise<boolean> {
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

async function updateQueueItem(
  id: number,
  updater: (existing: MutationRecord) => MutationRecord | null,
): Promise<boolean> {
  const db = await getDb();
  if (!db || !Number.isFinite(Number(id))) return false;

  try {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const existing = (await requestToPromise(store.get(Number(id)))) as MutationRecord | undefined;
    if (!existing) {
      await transactionDone(tx);
      return false;
    }
    const nextValue = updater(existing);
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

async function dispatchQueueEvent(type: string, detail: Record<string, unknown> = {}): Promise<void> {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(type, { detail }));
}

export async function getOfflineMutationQueueLength(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  try {
    const tx = db.transaction(STORE_NAME, "readonly");
    const count = await requestToPromise<number>(tx.objectStore(STORE_NAME).count() as unknown as IdbRequest);
    await transactionDone(tx);
    return Number(count || 0);
  } catch {
    return 0;
  }
}

export type EnqueueOfflineMutationInput = {
  url: string;
  method?: string;
  headers?: Record<string, unknown>;
  body?: unknown;
  meta?: Record<string, unknown>;
};

export type EnqueueOfflineMutationResult =
  | { ok: true; id: number; queueLength: number }
  | { ok: false; reason: "missing_url" | "idb_unavailable" | "write_failed" };

export async function enqueueOfflineMutation(
  { url, method = "POST", headers = {}, body = undefined, meta = {} }: EnqueueOfflineMutationInput = { url: "" },
): Promise<EnqueueOfflineMutationResult> {
  if (!url) return { ok: false, reason: "missing_url" };
  const db = await getDb();
  if (!db) return { ok: false, reason: "idb_unavailable" };

  const normalizedMethod = normalizeMethod(method);
  const normalizedHeaders = normalizeHeaders(headers);
  const now = Date.now();

  const record: MutationRecord = {
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
    const id = await requestToPromise<number>(tx.objectStore(STORE_NAME).add(record) as unknown as IdbRequest);
    await transactionDone(tx);
    const queueLength = await getOfflineMutationQueueLength();
    await dispatchQueueEvent("pod:offline-mutation-enqueued", { id, queueLength, method: normalizedMethod, url });
    return { ok: true, id, queueLength };
  } catch {
    return { ok: false, reason: "write_failed" };
  }
}

type ReplayOutcome =
  | { status: "success"; code: number }
  | { status: "retry"; code?: number; error: string }
  | { status: "drop"; code: number; error: string };

async function replayMutation(item: MutationRecord): Promise<ReplayOutcome> {
  const method = normalizeMethod(item?.method);
  const init: RequestInit = {
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
    return { status: "retry", error: (error as Error)?.message || "Network error" };
  }
}

export type DrainResult = {
  processed: number;
  succeeded: number;
  retried: number;
  dropped: number;
  remaining: number;
};

export async function drainOfflineMutationQueue({ limit = 25 }: { limit?: number } = {}): Promise<DrainResult> {
  if (drainingPromise) return drainingPromise;

  drainingPromise = (async (): Promise<DrainResult> => {
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
          cacheKeys: (item?.meta?.invalidateCacheKeys as string[] | undefined) ?? [],
          cacheTags: (item?.meta?.invalidateCacheTags as string[] | undefined) ?? [],
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
