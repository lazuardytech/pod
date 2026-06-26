import { enqueueOfflineMutation } from "@/shared/services/offlineMutationQueue";
import { invalidateOfflineJsonCache } from "@/shared/services/offlineJsonCache";

function isLikelyNetworkError(error: unknown): boolean {
  if (!error) return false;
  if ((error as { name?: string }).name === "AbortError") return false;
  if (typeof (error as { status?: unknown }).status === "number") return false;
  return true;
}

function normalizeMethod(method: unknown): string {
  return String(method || "POST").toUpperCase();
}

function buildInit(method: string, headers: Record<string, string>, body: unknown): RequestInit {
  const init: RequestInit = {
    method: normalizeMethod(method),
    headers: {
      "Content-Type": "application/json",
      ...(headers || {}),
    },
  };

  if (init.method !== "GET" && init.method !== "HEAD" && body !== undefined) {
    init.body = typeof body === "string" ? body : JSON.stringify(body);
  }

  return init;
}

async function readJsonIfAny(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) return null;
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export type MutateJsonWithOfflineQueueInput = {
  url: string;
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  queueMeta?: Record<string, unknown>;
  invalidateCacheKeys?: string[];
  invalidateCacheTags?: string[];
};

export type MutateJsonWithOfflineQueueResult =
  | { queued: true; queue: { ok: boolean; reason?: string }; response: null; data: null }
  | { queued: false; response: Response; data: unknown };

export async function mutateJsonWithOfflineQueue(
  {
    url,
    method = "POST",
    body = undefined,
    headers = {},
    queueMeta = {},
    invalidateCacheKeys = [],
    invalidateCacheTags = [],
  }: MutateJsonWithOfflineQueueInput = { url: "" },
): Promise<MutateJsonWithOfflineQueueResult> {
  if (!url) throw new Error("Missing request URL");

  const init = buildInit(method, headers, body);
  const invalidateLinkedCaches = async (): Promise<void> => {
    await invalidateOfflineJsonCache({
      cacheKeys: invalidateCacheKeys,
      cacheTags: invalidateCacheTags,
    });
  };

  const tryQueue = async (): Promise<MutateJsonWithOfflineQueueResult> => {
    const queued = await enqueueOfflineMutation({
      url,
      method: init.method ?? "POST",
      headers: (init.headers ?? {}) as Record<string, unknown>,
      body: init.body,
      meta: {
        ...(queueMeta && typeof queueMeta === "object" ? queueMeta : {}),
        invalidateCacheKeys,
        invalidateCacheTags,
      },
    });
    if (queued.ok) {
      await invalidateLinkedCaches();
    }
    return { queued: queued.ok === true, queue: queued, response: null, data: null };
  };

  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return tryQueue();
  }

  try {
    const response = await fetch(url, init);
    const data = await readJsonIfAny(response);
    if (!response.ok) {
      const errorMessage =
        data && typeof data === "object" && "error" in data && typeof (data as { error: unknown }).error === "string"
          ? (data as { error: string }).error
          : `HTTP ${response.status}`;
      const error = new Error(errorMessage) as Error & { status?: number; data?: unknown };
      error.status = response.status;
      error.data = data;
      throw error;
    }
    await invalidateLinkedCaches();
    return { queued: false, response, data };
  } catch (error) {
    if (isLikelyNetworkError(error)) {
      return tryQueue();
    }
    throw error;
  }
}
