import { getModelInfoCore } from "open-sse/services/model.js";
import { handleChatCore } from "open-sse/handlers/chatCore.js";
import { errorResponse } from "open-sse/utils/error.js";
import {
  checkFallbackError,
  isAccountUnavailable,
  getEarliestRateLimitedUntil,
  getUnavailableUntil,
  formatRetryAfter
} from "open-sse/services/accountFallback.js";
import { MAX_RATE_LIMIT_COOLDOWN_MS } from "open-sse/config/errorConfig.js";
import { getComboModelsFromData, handleComboChat } from "open-sse/services/combo.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import * as log from "../utils/logger.js";
import { refreshTokenByProvider } from "../services/tokenRefresh.js";
import { parseApiKey, extractBearerToken, type ParsedApiKey } from "../utils/apiKey.js";
import { getMachineData, saveMachineData } from "../services/storage.js";

const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000;

async function getModelInfo(modelStr: string, machineId: string, env: Env): Promise<{ provider: string; model: string }> {
  const data = await getMachineData(machineId, env);
  const info = await getModelInfoCore(modelStr, (data?.modelAliases as Record<string, string>) || {});
  return info as { provider: string; model: string };
}

interface CredentialsResult {
  id: string;
  apiKey?: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: string;
  projectId?: string;
  copilotToken?: string;
  providerSpecificData?: Record<string, unknown>;
  status?: string;
  lastError?: string | null;
  rateLimitedUntil?: string | null;
}

interface CredentialsError {
  allRateLimited: true;
  retryAfter: string;
  retryAfterHuman: string;
  lastError?: string | null;
  lastErrorCode?: string | null;
}

type CredentialsResponse = CredentialsResult | CredentialsError | null;

interface ChatCoreResult {
  success: boolean;
  response: Response;
  status?: number;
  error?: string;
  resetsAtMs?: number;
}

/**
 * Handle chat request
 */
export async function handleChat(
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
  machineIdOverride: string | null = null
): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "*"
      }
    });
  }

  // Determine machineId: from URL (old) or from API key (new)
  let machineId: string | null = machineIdOverride;

  if (!machineId) {
    // New format: extract machineId from API key
    const apiKey = extractBearerToken(request);
    if (!apiKey) return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Missing API key");

    const parsed: ParsedApiKey | null = await parseApiKey(apiKey);
    if (!parsed) return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Invalid API key format");

    if (!parsed.isNewFormat || !parsed.machineId) {
      return errorResponse(
        HTTP_STATUS.BAD_REQUEST,
        "API key does not contain machineId. Use /{machineId}/v1/... endpoint for old format keys."
      );
    }

    machineId = parsed.machineId;
  }

  if (!machineId) {
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Could not resolve machineId");
  }

  if (!(await validateApiKey(request, machineId, env))) {
    return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Invalid API key");
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid JSON body");
  }

  log.info("CHAT", `${machineId} | ${body.model as string}`, { stream: body.stream !== false });

  const modelStr = body.model as string | undefined;
  if (!modelStr) return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing model");

  // Check if model is a combo
  const data = await getMachineData(machineId, env);
  const comboModels = getComboModelsFromData(modelStr, (data?.combos as Array<unknown>) || []);

  if (comboModels) {
    log.info("COMBO", `"${modelStr}" with ${comboModels.length} models`);
    return handleComboChat({
      body,
      models: comboModels,
      handleSingleModel: (reqBody: Record<string, unknown>, model: string) =>
        handleSingleModelChat(reqBody, model, machineId!, env),
      log
    });
  }

  // Single model request
  return handleSingleModelChat(body, modelStr, machineId, env);
}

/**
 * Handle single model chat request
 */
async function handleSingleModelChat(
  body: Record<string, unknown>,
  modelStr: string,
  machineId: string,
  env: Env
): Promise<Response> {
  const modelInfo = await getModelInfo(modelStr, machineId, env);
  if (!modelInfo.provider) return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid model format");

  const { provider, model } = modelInfo;
  log.info("MODEL", `${provider.toUpperCase()} | ${model}`);

  let excludeConnectionId: string | null = null;
  let lastError: string | null = null;
  let lastStatus: number | null = null;

  // Loop guard: cap iterations + CPU deadline (25s, 5s before free-tier 30s limit)
  const loopStartTime = Date.now();
  const CPU_DEADLINE_MS = 25000;
  let iterations = 0;
  const maxIterations = 20;

  while (true) {
    iterations++;
    if (iterations > maxIterations) {
      log.warn("CHAT", `${provider.toUpperCase()} | fallback loop exceeded max iterations (${maxIterations})`);
      return new Response(
        JSON.stringify({ error: { message: "All accounts unavailable after max retries" } }),
        { status: HTTP_STATUS.SERVICE_UNAVAILABLE, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }
      );
    }
    if (Date.now() - loopStartTime > CPU_DEADLINE_MS) {
      log.warn("CHAT", `${provider.toUpperCase()} | fallback loop exceeded CPU deadline`);
      return new Response(
        JSON.stringify({ error: { message: "Request timeout — all accounts exhausted" } }),
        { status: HTTP_STATUS.GATEWAY_TIMEOUT, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }
      );
    }

    const credentials: CredentialsResponse = await getProviderCredentials(machineId, provider, env, excludeConnectionId);
    if (!credentials || (credentials as CredentialsError).allRateLimited) {
      const errCreds = credentials as CredentialsError | null;
      if (errCreds?.allRateLimited) {
        const retryAfterSec = Math.ceil((new Date(errCreds.retryAfter).getTime() - Date.now()) / 1000);
        const errorMsg = lastError || errCreds.lastError || "Unavailable";
        const msg = `[${provider}/${model}] ${errorMsg} (${errCreds.retryAfterHuman})`;
        const status = lastStatus || Number(errCreds.lastErrorCode) || HTTP_STATUS.SERVICE_UNAVAILABLE;
        log.warn("CHAT", `${provider.toUpperCase()} | ${msg}`);
        return new Response(
          JSON.stringify({ error: { message: msg } }),
          { status, headers: { "Content-Type": "application/json", "Retry-After": String(Math.max(retryAfterSec, 1)), "Access-Control-Allow-Origin": "*" } }
        );
      }
      if (!excludeConnectionId) {
        return errorResponse(HTTP_STATUS.BAD_REQUEST, `No credentials for provider: ${provider}`);
      }
      log.warn("CHAT", `${provider.toUpperCase()} | no more accounts`);
      return new Response(
        JSON.stringify({ error: lastError || "All accounts unavailable" }),
        { status: lastStatus || HTTP_STATUS.SERVICE_UNAVAILABLE, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }
      );
    }

    const credResult = credentials as CredentialsResult;
    log.debug("CHAT", `account=${credResult.id}`, { provider });

    const refreshedCredentials = await checkAndRefreshToken(machineId, provider, credResult, env);

    // Use shared chatCore
    const result: ChatCoreResult = await handleChatCore({
      body,
      modelInfo: { provider, model },
      credentials: refreshedCredentials,
      log,
      onCredentialsRefreshed: async (newCreds: Record<string, unknown>) => {
        await updateCredentials(machineId, credResult.id, newCreds, env);
      },
      onRequestSuccess: async () => {
        // Clear error status only if currently has error (optimization)
        await clearAccountError(machineId, credResult.id, credResult, env);
      }
    });

    if (result.success) return result.response;

    const { shouldFallback } = checkFallbackError(result.status!, result.error!);

    if (shouldFallback) {
      log.warn("FALLBACK", `${provider.toUpperCase()} | ${credResult.id} | ${result.status}`);
      await markAccountUnavailable(machineId, credResult.id, result.status!, result.error!, env, result.resetsAtMs);
      excludeConnectionId = credResult.id;
      lastError = result.error ?? null;
      lastStatus = result.status ?? null;
      continue;
    }

    return result.response;
  }
}

async function checkAndRefreshToken(
  machineId: string,
  provider: string,
  credentials: CredentialsResult,
  env: Env
): Promise<CredentialsResult> {
  if (!credentials.expiresAt) return credentials;

  const expiresAt = new Date(credentials.expiresAt).getTime();
  if (expiresAt - Date.now() >= TOKEN_EXPIRY_BUFFER_MS) return credentials;

  log.debug("TOKEN", `${provider.toUpperCase()} | expiring, refreshing`);

  const newCredentials = await refreshTokenByProvider(provider, credentials as unknown as Record<string, unknown>);
  if (newCredentials?.accessToken) {
    await updateCredentials(machineId, credentials.id, newCredentials as unknown as Record<string, unknown>, env);
    return {
      ...credentials,
      accessToken: newCredentials.accessToken as string,
      refreshToken: (newCredentials.refreshToken as string) || credentials.refreshToken,
      expiresAt: newCredentials.expiresIn
        ? new Date(Date.now() + (newCredentials.expiresIn as number) * 1000).toISOString()
        : credentials.expiresAt
    };
  }

  return credentials;
}

async function validateApiKey(request: Request, machineId: string, env: Env): Promise<boolean> {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return false;

  const apiKey = authHeader.slice(7);
  const data = await getMachineData(machineId, env);
  return (data?.apiKeys as Array<{ key: string }>)?.some(k => k.key === apiKey) || false;
}

async function getProviderCredentials(
  machineId: string,
  provider: string,
  env: Env,
  excludeConnectionId: string | null = null
): Promise<CredentialsResponse> {
  const data = await getMachineData(machineId, env);
  const providers = data?.providers as Record<string, Record<string, unknown>> | undefined;
  if (!providers) return null;

  const providerConnections = Object.entries(providers)
    .filter(([connId, conn]) => {
      if ((conn.provider as string) !== provider || !conn.isActive) return false;
      if (excludeConnectionId && connId === excludeConnectionId) return false;
      if (isAccountUnavailable(conn.rateLimitedUntil as string | undefined)) return false;
      return true;
    })
    .sort((a, b) => ((a[1].priority as number) || 999) - ((b[1].priority as number) || 999));

  if (providerConnections.length === 0) {
    const allConnections = Object.entries(providers)
      .filter(([, conn]) => (conn.provider as string) === provider && conn.isActive)
      .map(([, conn]) => conn);
    const earliest = getEarliestRateLimitedUntil(allConnections.map(c => c.rateLimitedUntil as string | undefined));
    if (earliest) {
      const rateLimitedConns = allConnections.filter(
        c => c.rateLimitedUntil && new Date(c.rateLimitedUntil as string).getTime() > Date.now()
      );
      const earliestConn = rateLimitedConns.sort(
        (a, b) => new Date(a.rateLimitedUntil as string).getTime() - new Date(b.rateLimitedUntil as string).getTime()
      )[0];
      return {
        allRateLimited: true,
        retryAfter: earliest,
        retryAfterHuman: formatRetryAfter(earliest),
        lastError: (earliestConn?.lastError as string) || null,
        lastErrorCode: (earliestConn?.errorCode as string) || null
      };
    }
    return null;
  }

  const [connectionId, connection] = providerConnections[0];

  return {
    id: connectionId,
    apiKey: connection.apiKey as string | undefined,
    accessToken: connection.accessToken as string | undefined,
    refreshToken: connection.refreshToken as string | undefined,
    expiresAt: connection.expiresAt as string | undefined,
    projectId: connection.projectId as string | undefined,
    copilotToken: (connection.providerSpecificData as Record<string, unknown> | undefined)?.copilotToken as string | undefined,
    providerSpecificData: connection.providerSpecificData as Record<string, unknown> | undefined,
    status: connection.status as string | undefined,
    lastError: connection.lastError as string | null | undefined,
    rateLimitedUntil: connection.rateLimitedUntil as string | null | undefined
  };
}

async function markAccountUnavailable(
  machineId: string,
  connectionId: string,
  status: number | string,
  errorText: string,
  env: Env,
  resetsAtMs: number | null = null
): Promise<void> {
  const data = await getMachineData(machineId, env);
  const providers = data?.providers as Record<string, Record<string, unknown>> | undefined;
  if (!providers?.[connectionId]) return;

  const conn = providers[connectionId];
  const backoffLevel = (conn.backoffLevel as number) || 0;
  let cooldownMs: number;
  let newBackoffLevel: number;
  if (resetsAtMs && resetsAtMs > Date.now()) {
    cooldownMs = Math.min(resetsAtMs - Date.now(), MAX_RATE_LIMIT_COOLDOWN_MS);
    newBackoffLevel = 0;
  } else {
    const fallbackResult = checkFallbackError(status as number, errorText, backoffLevel);
    cooldownMs = fallbackResult.cooldownMs!;
    newBackoffLevel = fallbackResult.newBackoffLevel!;
  }
  const rateLimitedUntil = getUnavailableUntil(cooldownMs);
  const reason = typeof errorText === "string" ? errorText.slice(0, 100) : "Provider error";

  conn.rateLimitedUntil = rateLimitedUntil;
  conn.status = "unavailable";
  conn.lastError = reason;
  conn.errorCode = status || null;
  conn.lastErrorAt = new Date().toISOString();
  conn.backoffLevel = newBackoffLevel ?? backoffLevel;
  conn.updatedAt = new Date().toISOString();

  await saveMachineData(machineId, data!, env);
  log.warn("ACCOUNT", `${connectionId} | unavailable until ${rateLimitedUntil} (backoff=${newBackoffLevel ?? backoffLevel})`);
}

async function clearAccountError(
  machineId: string,
  connectionId: string,
  currentCredentials: CredentialsResult,
  env: Env
): Promise<void> {
  const hasError =
    currentCredentials.status === "unavailable" ||
    currentCredentials.lastError ||
    currentCredentials.rateLimitedUntil;

  if (!hasError) return;

  const data = await getMachineData(machineId, env);
  const providers = data?.providers as Record<string, Record<string, unknown>> | undefined;
  if (!providers?.[connectionId]) return;

  const conn = providers[connectionId];
  conn.status = "active";
  conn.lastError = null;
  conn.lastErrorAt = null;
  conn.rateLimitedUntil = null;
  conn.backoffLevel = 0;
  conn.updatedAt = new Date().toISOString();

  await saveMachineData(machineId, data!, env);
  log.info("ACCOUNT", `${connectionId} | error cleared`);
}

async function updateCredentials(
  machineId: string,
  connectionId: string,
  newCredentials: Record<string, unknown>,
  env: Env
): Promise<void> {
  const data = await getMachineData(machineId, env);
  const providers = data?.providers as Record<string, Record<string, unknown>> | undefined;
  if (!providers?.[connectionId]) return;

  const conn = providers[connectionId];
  conn.accessToken = newCredentials.accessToken;
  if (newCredentials.refreshToken) conn.refreshToken = newCredentials.refreshToken;
  if (newCredentials.expiresIn) {
    conn.expiresAt = new Date(Date.now() + (newCredentials.expiresIn as number) * 1000).toISOString();
    conn.expiresIn = newCredentials.expiresIn;
  }
  conn.updatedAt = new Date().toISOString();

  await saveMachineData(machineId, data!, env);
  log.debug("TOKEN", `credentials updated | ${connectionId}`);
}
