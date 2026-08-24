/**
 * Qoder model catalog fetcher.
 *
 * Calls /algo/api/v2/model/list (COSY-signed) on the inference host to get
 * the live catalog for an authenticated Qoder account, then caches the
 * per-model `model_config` blocks by key. Chat requests later look up the
 * exact server-published metadata for the model they want — Qoder's chat
 * endpoint silently downgrades to a different model when the wrong
 * model_config is sent.
 *
 * On any error the live cache stays empty and chatExecuteCall surfaces the
 * problem to the user as "model config not yet fetched, retry shortly".
 */

import { createHash } from "node:crypto";
import { QODER_MODEL_LIST_URL } from "@/lib/qoder/constants";
import { buildCosyHeaders } from "@/lib/qoder/cosy";
import type {
  ExecutorCredentials,
  ExecutorLogger,
  ExecutorProxyOptions,
  ExecutorProviderData,
} from "../executors/base.ts";
import { proxyAwareFetch } from "../utils/proxyFetch.ts";

const FETCH_TIMEOUT_MS = 15_000;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1h, same as the Kiro catalog

type JsonRecord = Record<string, unknown>;

type QoderProviderData = ExecutorProviderData & {
  userId?: string;
  machineId?: string;
};

export type QoderCredentials = ExecutorCredentials & {
  displayName?: string;
  providerSpecificData?: QoderProviderData;
};

export type QoderModelSummary = {
  id: string;
  name: string;
  contextLength: number;
  isVL: boolean;
  isReasoning: boolean;
  maxOutputTokens: number;
  description: string;
};

export type QoderCatalogCacheEntry = {
  expiresAt: number;
  models: QoderModelSummary[];
  rawConfigs: Map<string, JsonRecord>;
  fetched: boolean;
};

export type ResolveQoderModelsOptions = {
  forceRefresh?: boolean;
  log?: ExecutorLogger;
  proxyOptions?: ExecutorProxyOptions;
  signal?: AbortSignal | null;
};

const catalogCache = new Map<string, QoderCatalogCacheEntry>();

/**
 * In-flight fetch promises keyed by cacheKey. Concurrent first-time
 * callers (parallel chat windows) all observe the same Promise so we
 * fan-out exactly one upstream request per credential per miss.
 */
const inflight = new Map<string, Promise<QoderCatalogCacheEntry | null>>();

/**
 * Stable cache key per credential (so different login sessions for the same
 * account share an entry).
 */
function cacheKey(credentials: QoderCredentials | null | undefined): string {
  const psd = credentials?.providerSpecificData || {};
  const seed = psd.userId || credentials?.refreshToken || credentials?.accessToken || "anonymous";
  return createHash("sha256").update(`qoder:${seed}`).digest("hex");
}

/**
 * Strip credential -> COSY creds for buildCosyHeaders.
 */
function cosyCredsFromConnection(credentials: QoderCredentials) {
  const psd = credentials.providerSpecificData || {};
  return {
    userId: psd.userId || "",
    authToken: credentials.accessToken || "",
    name: credentials.displayName || "",
    email: credentials.email || "",
    machineId: psd.machineId || "",
  };
}

/**
 * Fetch the live model list for this credential. Returns:
 *   { models: [{ id, name, contextLength, isVL, isReasoning, ... }, ...],
 *     rawConfigs: Map<modelKey, modelConfigObject> }
 * or `null` on any error.
 */
async function fetchQoderCatalogRaw(
  credentials: QoderCredentials,
  signal: AbortSignal | null | undefined,
  proxyOptions: ExecutorProxyOptions = null,
): Promise<{ models: QoderModelSummary[]; rawConfigs: Map<string, JsonRecord> } | null> {
  const creds = cosyCredsFromConnection(credentials);
  if (!creds.userId || !creds.authToken) return null;

  const headers = {
    Accept: "application/json",
    "Accept-Encoding": "identity",
    ...buildCosyHeaders(Buffer.alloc(0), QODER_MODEL_LIST_URL, creds),
  };

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let abortListener: (() => void) | null = null;
  let response: Response;
  try {
    timer = setTimeout(() => controller.abort("timeout"), FETCH_TIMEOUT_MS);
    if (signal && typeof signal.addEventListener === "function") {
      // If the parent signal already aborted before we got here, the
      // 'abort' event has already fired and addEventListener won't
      // re-trigger it. Propagate the cancellation immediately.
      if (signal.aborted) {
        controller.abort(signal.reason);
      } else {
        abortListener = () => controller.abort(signal.reason);
        signal.addEventListener("abort", abortListener);
      }
    }
    response = await proxyAwareFetch(
      QODER_MODEL_LIST_URL,
      {
        method: "GET",
        headers,
        signal: controller.signal,
      },
      proxyOptions,
    );
  } finally {
    if (timer) clearTimeout(timer);
    if (signal && abortListener) signal.removeEventListener("abort", abortListener);
  }

  if (!response.ok) return null;

  const bodyUnknown: unknown = await response.json().catch(() => null);
  if (
    !bodyUnknown ||
    typeof bodyUnknown !== "object" ||
    !Array.isArray((bodyUnknown as JsonRecord).chat)
  ) {
    return null;
  }
  const body = bodyUnknown as JsonRecord & { chat: unknown[] };

  const models: QoderModelSummary[] = [];
  const rawConfigs = new Map<string, JsonRecord>();
  for (const entryUnknown of body.chat) {
    if (!entryUnknown || typeof entryUnknown !== "object") continue;
    const entry = entryUnknown as JsonRecord;
    const key = entry.key;
    if (typeof key !== "string" || !key) continue;

    // Always cache the config — chat needs model_config even for UI-hidden
    // models (enable:false). Upstream still accepts chat for these keys.
    rawConfigs.set(key, entry);
    if (entry.enable === false) continue;

    const display = typeof entry.display_name === "string" ? entry.display_name : key;
    const ctx = Number(entry.max_input_tokens) || 131_072;
    models.push({
      id: key,
      name: `${display}`,
      contextLength: ctx,
      isVL: !!entry.is_vl,
      isReasoning: !!entry.is_reasoning,
      maxOutputTokens: Number(entry.max_output_tokens) || 0,
      description: typeof entry.description === "string" ? entry.description : "",
    });
  }

  return { models, rawConfigs };
}

/**
 * Get the cached model_config block for a given model key, fetching the
 * catalog first if needed. Returns null when the catalog can't be fetched
 * (so callers can fall back to the static registry).
 */
export async function getQoderModelConfig(
  credentials: QoderCredentials,
  modelKey: string,
  options: ResolveQoderModelsOptions = {},
): Promise<(JsonRecord & { key: string }) | null> {
  const cached = await resolveQoderModels(credentials, options);
  if (!cached) return null;
  const config = cached.rawConfigs.get(modelKey);
  if (!config) return null;
  // Defensive copy — chat code may mutate `key` to align with the alias path.
  return { ...config, key: modelKey };
}

/**
 * Resolve the live model catalog + raw configs for a credential. Caches
 * results for CACHE_TTL_MS so repeated chat requests don't re-fetch, and
 * deduplicates concurrent misses so parallel chat windows fan-out exactly
 * one upstream request per credential.
 */
export async function resolveQoderModels(
  credentials: QoderCredentials | null | undefined,
  options: ResolveQoderModelsOptions = {},
): Promise<QoderCatalogCacheEntry | null> {
  if (!credentials?.accessToken) return null;
  const psd = credentials.providerSpecificData || {};
  if (!psd.userId) return null;

  const key = cacheKey(credentials);
  const now = Date.now();
  if (!options.forceRefresh) {
    const cached = catalogCache.get(key);
    if (cached && cached.expiresAt > now) {
      return cached;
    }
  }

  // Coalesce concurrent misses on the same credential into one upstream call.
  // forceRefresh callers still get their own fetch (they wanted fresh data).
  const existing = inflight.get(key);
  if (existing && !options.forceRefresh) {
    return existing;
  }

  const fetchPromise = (async (): Promise<QoderCatalogCacheEntry | null> => {
    const fetched = await fetchQoderCatalogRaw(credentials, options.signal, options.proxyOptions);
    if (!fetched) return null;
    const entry: QoderCatalogCacheEntry = {
      expiresAt: Date.now() + CACHE_TTL_MS,
      models: fetched.models,
      rawConfigs: fetched.rawConfigs,
      fetched: true,
    };
    catalogCache.set(key, entry);
    return entry;
  })();

  inflight.set(key, fetchPromise);
  try {
    return await fetchPromise;
  } finally {
    // Clear only if this is still the in-flight entry — a forceRefresh
    // call that started later may have replaced it.
    if (inflight.get(key) === fetchPromise) {
      inflight.delete(key);
    }
  }
}

export function invalidateQoderCatalog(credentials: QoderCredentials | null | undefined) {
  if (!credentials) return;
  catalogCache.delete(cacheKey(credentials));
}

export function clearQoderCatalog() {
  catalogCache.clear();
}
