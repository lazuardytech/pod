import * as log from "../utils/logger.ts";
import { getMachineData, saveMachineData, deleteMachineData } from "../services/storage.ts";

const CORS_HEADERS: Record<string, string> = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
};

// Shared secret between dashboard (server) and worker — set via env secret binding.
// The dashboard sends this as x-pod-cloud-secret header on every sync request.
const HEADER = "x-pod-cloud-secret";

function requireCloudSecret(request: Request, env: Env): boolean {
  const secret = request.headers.get(HEADER);
  if (!secret || !env.CLOUD_SYNC_SECRET) return false;
  return secret === env.CLOUD_SYNC_SECRET;
}

export async function handleSync(
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
): Promise<Response> {
  const url = new URL(request.url);
  const machineId = url.pathname.split("/")[2]; // /sync/:machineId

  // Handle CORS preflight
  if (request.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "*",
      },
    });
  }

  if (!machineId) {
    log.warn("SYNC", "Missing machineId in path");
    return jsonResponse({ error: "Missing machineId" }, 400);
  }

  // Auth gate: require shared cloud sync secret
  if (!requireCloudSecret(request, env)) {
    log.warn("SYNC", "Unauthorized sync attempt", { machineId });
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  // Route by method
  switch (request.method) {
    case "GET":
      return handleGet(machineId, env);
    case "POST":
      return handlePost(request, machineId, env);
    case "DELETE":
      return handleDelete(machineId, env);
    default:
      return jsonResponse({ error: "Method not allowed" }, 405);
  }
}

/**
 * GET /sync/:machineId - Return merged data for Web to update
 */
async function handleGet(machineId: string, env: Env): Promise<Response> {
  const data = await getMachineData(machineId, env);

  if (!data) {
    log.warn("SYNC", "No data found", { machineId });
    return jsonResponse({ error: "No data found" }, 404);
  }

  log.info("SYNC", "Data retrieved", { machineId });
  return jsonResponse({
    success: true,
    data,
  });
}

interface SyncBody {
  providers?: Array<Record<string, unknown>>;
  modelAliases?: Record<string, string>;
  combos?: Array<unknown>;
  apiKeys?: Array<unknown>;
  comboStrategies?: Record<string, unknown>;
  comboStrategy?: string;
}

/**
 * POST /sync/:machineId - Merge Web data with Worker data
 * providers stored by ID (supports multiple connections per provider)
 */
async function handlePost(request: Request, machineId: string, env: Env): Promise<Response> {
  let body: SyncBody;
  try {
    body = (await request.json()) as SyncBody;
  } catch {
    log.warn("SYNC", "Invalid JSON body", { machineId });
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  // Validate required fields
  if (!body.providers || !Array.isArray(body.providers)) {
    log.warn("SYNC", "Missing or invalid providers array", { machineId });
    return jsonResponse({ error: "Missing providers array" }, 400);
  }

  const existingData = (await getMachineData(machineId, env)) || {
    providers: {},
    modelAliases: {},
    apiKeys: [],
  };

  // Merge providers by ID
  const mergedProviders: Record<string, unknown> = {};
  const changes: { updated: string[]; fromWorker: string[] } = { updated: [], fromWorker: [] };

  for (const webProvider of body.providers) {
    const providerId = webProvider.id as string | undefined;
    if (!providerId) {
      log.warn("SYNC", "Provider missing id", { provider: webProvider.provider as string });
      continue;
    }

    const workerProvider = (existingData.providers as Record<string, unknown>)[providerId];

    if (workerProvider) {
      // Merge: token fields from Worker, config fields from Web
      mergedProviders[providerId] = mergeProvider(
        webProvider,
        workerProvider as Record<string, unknown>,
        changes,
        providerId,
      );
    } else {
      // New provider from Web
      mergedProviders[providerId] = formatProviderData(webProvider);
      changes.updated.push(providerId);
    }
  }

  // Prepare final data - modelAliases, apiKeys, combos always from Web
  const finalData: Record<string, unknown> = {
    providers: mergedProviders,
    modelAliases: body.modelAliases || (existingData.modelAliases as Record<string, string>) || {},
    combos: body.combos || (existingData.combos as Array<unknown>) || [],
    apiKeys: body.apiKeys || (existingData.apiKeys as Array<unknown>) || [],
    comboStrategies: body.comboStrategies || existingData.comboStrategies || {},
    comboStrategy: body.comboStrategy || existingData.comboStrategy || "fallback",
    updatedAt: new Date().toISOString(),
  };

  // Store in D1 + invalidate cache
  await saveMachineData(machineId, finalData, env);

  log.info("SYNC", "Data synced successfully", {
    machineId,
    providerCount: Object.keys(mergedProviders).length,
    changes,
  });

  return jsonResponse({
    success: true,
    data: finalData,
    changes,
  });
}

/**
 * DELETE /sync/:machineId - Clear cache when Worker is disabled
 */
async function handleDelete(machineId: string, env: Env): Promise<Response> {
  await deleteMachineData(machineId, env);

  log.info("SYNC", "Data deleted", { machineId });
  return jsonResponse({
    success: true,
    message: "Data deleted successfully",
  });
}

/**
 * Merge provider data: compare updatedAt to decide which source to use
 * Simple logic: newer wins (sync entire provider)
 */
function mergeProvider(
  webProvider: Record<string, unknown>,
  workerProvider: Record<string, unknown>,
  changes: { updated: string[]; fromWorker: string[] },
  providerId: string,
): Record<string, unknown> {
  const webTime = new Date((webProvider.updatedAt as string) || 0).getTime();
  const workerTime = new Date((workerProvider.updatedAt as string) || 0).getTime();

  let merged: Record<string, unknown>;

  if (workerTime > webTime) {
    // Cloud has newer data - use entire Cloud provider
    merged = formatProviderData(workerProvider);
    changes.fromWorker.push(providerId);
  } else {
    // Server has newer data - use entire Server provider
    merged = formatProviderData(webProvider);
    changes.updated.push(providerId);
  }

  // Always update timestamp
  merged.updatedAt = new Date().toISOString();
  return merged;
}

/**
 * Format provider data for storage
 */
function formatProviderData(provider: Record<string, unknown>): Record<string, unknown> {
  return {
    id: provider.id,
    provider: provider.provider,
    authType: provider.authType,
    name: provider.name,
    displayName: provider.displayName,
    email: provider.email,
    priority: provider.priority,
    globalPriority: provider.globalPriority,
    defaultModel: provider.defaultModel,
    accessToken: provider.accessToken,
    refreshToken: provider.refreshToken,
    expiresAt: provider.expiresAt,
    expiresIn: provider.expiresIn,
    tokenType: provider.tokenType,
    scope: provider.scope,
    idToken: provider.idToken,
    projectId: provider.projectId,
    apiKey: provider.apiKey,
    providerSpecificData: provider.providerSpecificData || {},
    isActive: provider.isActive,
    status: provider.status || "active",
    lastError: provider.lastError || null,
    lastErrorAt: provider.lastErrorAt || null,
    errorCode: provider.errorCode || null,
    rateLimitedUntil: provider.rateLimitedUntil || null,
    createdAt: provider.createdAt,
    updatedAt: provider.updatedAt || new Date().toISOString(),
  };
}

/**
 * Update provider status (called when token refresh fails or API errors)
 */
export function updateProviderStatus(
  providers: Record<string, unknown>,
  providerId: string,
  status: string,
  error: string | null = null,
  errorCode: string | null = null,
): Record<string, unknown> {
  const provider = providers[providerId] as Record<string, unknown> | undefined;
  if (provider) {
    provider.status = status;
    provider.lastError = error;
    provider.lastErrorAt = error ? new Date().toISOString() : null;
    provider.errorCode = errorCode;
    provider.updatedAt = new Date().toISOString();
  }
  return providers;
}

/**
 * Helper to create JSON response
 */
function jsonResponse(data: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: CORS_HEADERS,
  });
}
