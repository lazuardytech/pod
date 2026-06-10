import { enqueueOfflineMutation } from "@/shared/services/offlineMutationQueue";
import { invalidateOfflineJsonCache } from "@/shared/services/offlineJsonCache";

function isLikelyNetworkError(error) {
  if (!error) return false;
  if (error.name === "AbortError") return false;
  if (typeof error.status === "number") return false;
  return true;
}

function normalizeMethod(method) {
  return String(method || "POST").toUpperCase();
}

function buildInit(method, headers, body) {
  const init = {
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

async function readJsonIfAny(response) {
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) return null;
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export async function mutateJsonWithOfflineQueue({
  url,
  method = "POST",
  body = undefined,
  headers = {},
  queueMeta = {},
  invalidateCacheKeys = [],
  invalidateCacheTags = [],
} = {}) {
  if (!url) throw new Error("Missing request URL");

  const init = buildInit(method, headers, body);
  const invalidateLinkedCaches = async () => {
    await invalidateOfflineJsonCache({
      cacheKeys: invalidateCacheKeys,
      cacheTags: invalidateCacheTags,
    });
  };

  const tryQueue = async () => {
    const queued = await enqueueOfflineMutation({
      url,
      method: init.method,
      headers: init.headers,
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
      const error = new Error(data?.error || `HTTP ${response.status}`);
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
