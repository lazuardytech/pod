// Ambient declarations for the local `open-sse/` engine (stays JS per plan).
declare module "open-sse/*";
declare module "open-sse/index.js" {
  export {};
}
declare module "open-sse/config/runtimeConfig.js" {
  export const HTTP_STATUS: {
    BAD_REQUEST: number;
    UNAUTHORIZED: number;
    FORBIDDEN: number;
    NOT_FOUND: number;
    METHOD_NOT_ALLOWED: number;
    PAYLOAD_TOO_LARGE: number;
    TOO_MANY_REQUESTS: number;
    INTERNAL_SERVER_ERROR: number;
    BAD_GATEWAY: number;
    SERVICE_UNAVAILABLE: number;
    GATEWAY_TIMEOUT: number;
  };
  export const BACKOFF_CONFIG: Record<string, unknown>;
  export const CACHE_TTL: Record<string, number>;
  export const COOLDOWN_MS: Record<string, number>;
  export const DEFAULT_MAX_TOKENS: number;
}
declare module "open-sse/config/errorConfig.js" {
  export const MAX_RATE_LIMIT_COOLDOWN_MS: number;
}
declare module "open-sse/handlers/chatCore.js" {
  export type ChatCoreResult =
    | { success: true; response: Response }
    | { success: false; status: number; error: string; resetsAtMs?: number | null };
  export interface ChatCoreParams {
    body: Record<string, unknown>;
    modelInfo: { provider: string; model: string };
    credentials: Record<string, unknown> | null;
    log: unknown;
    clientRawRequest?: unknown;
    connectionId: string;
    userAgent?: string;
    apiKey?: string | null;
    ccFilterNaming?: boolean;
    rtkEnabled?: boolean;
    cavemanEnabled?: boolean;
    cavemanLevel?: string;
    providerThinking?: unknown;
    contentFilterMessage?: string | null;
    chatSettings?: Record<string, unknown>;
    memoryOwnerId?: string | null;
    comboName?: string | null;
    sourceFormatOverride?: string | null;
    onCredentialsRefreshed?: (newCreds: Record<string, unknown>) => Promise<void> | void;
    onRequestSuccess?: () => Promise<void> | void;
  }
  export function handleChatCore(params: ChatCoreParams): Promise<ChatCoreResult>;
  export function isTokenExpiringSoon(token: unknown): boolean;
}
declare module "open-sse/handlers/embeddingsCore.js" {
  export type EmbeddingsResult =
    | { success: true; response: Response }
    | { success: false; status: number; error: string };
  export interface EmbeddingsCoreParams {
    body: Record<string, unknown>;
    modelInfo: { provider: string; model: string };
    credentials: Record<string, unknown> | null;
    log: unknown;
    onCredentialsRefreshed?: (newCreds: Record<string, unknown>) => Promise<void> | void;
    onRequestSuccess?: () => Promise<void> | void;
  }
  export function handleEmbeddingsCore(params: EmbeddingsCoreParams): Promise<EmbeddingsResult>;
}
declare module "open-sse/handlers/imageGenerationCore.js" {
  export type ImageGenResult =
    | { success: true; response: Response }
    | { success: false; status: number; error: string };
  export interface ImageGenCoreParams {
    body: Record<string, unknown>;
    modelInfo: { provider: string; model: string };
    credentials: Record<string, unknown> | null;
    binaryOutput?: boolean;
    streamToClient?: boolean;
    onCredentialsRefreshed?: (newCreds: Record<string, unknown>) => Promise<void> | void;
    onRequestSuccess?: () => Promise<void> | void;
  }
  export function handleImageGenerationCore(params: ImageGenCoreParams): Promise<ImageGenResult>;
}
declare module "open-sse/handlers/sttCore.js" {
  export type SttResult =
    | { success: true; response: Response }
    | { success: false; status: number; error: string };
  export function handleSttCore(params: {
    provider: string;
    model: string;
    formData?: FormData;
    credentials?: Record<string, unknown> | null;
  }): Promise<SttResult>;
}
declare module "open-sse/handlers/ttsCore.js" {
  export type TtsResult =
    | { success: true; response: Response }
    | { success: false; status: number; error: string };
  export function handleTtsCore(params: {
    provider: string;
    model: string;
    input: string;
    responseFormat?: string;
    language?: string;
    credentials?: Record<string, unknown> | null;
  }): Promise<TtsResult>;
}
declare module "open-sse/handlers/fetch/index.js" {
  export type FetchResult =
    | { success: true; data: unknown; response?: Response }
    | { success: false; status: number; error: string };
  export interface FetchCoreParams {
    url: string;
    format?: string;
    maxCharacters?: number;
    provider: string;
    providerConfig: unknown;
    credentials: Record<string, unknown> | null;
    log: unknown;
    onCredentialsRefreshed?: (newCreds: Record<string, unknown>) => Promise<void> | void;
    onRequestSuccess?: () => Promise<void> | void;
  }
  export function handleFetchCore(params: FetchCoreParams): Promise<FetchResult>;
}
declare module "open-sse/handlers/search/index.js" {
  export type SearchResult =
    | { success: true; response: Response }
    | { success: false; status: number; error: string };
  export interface SearchCoreParams {
    body: Record<string, unknown>;
    provider: unknown;
    providerConfig: unknown;
    credentials: Record<string, unknown> | null;
    log: unknown;
    onCredentialsRefreshed?: (newCreds: Record<string, unknown>) => Promise<void> | void;
    onRequestSuccess?: () => Promise<void> | void;
  }
  export function handleSearchCore(params: SearchCoreParams): Promise<SearchResult>;
}
declare module "open-sse/services/combo.js" {
  export interface ComboChatParams {
    body: Record<string, unknown>;
    models: string[];
    handleSingleModel: (body: Record<string, unknown>, model: string) => Promise<Response>;
    log: unknown;
    comboName: string;
    comboStrategy?: string;
    comboStickyLimit?: number;
  }
  export function handleComboChat(params: ComboChatParams): Promise<Response>;
  export function injectComboSystemPrompt(body: Record<string, unknown>, prompt: string): void;
  export function overrideResponseModelId(response: Response, modelId: string): Promise<Response>;
  export function getComboModelsFromData(
    name: string,
    combos: Array<{ name: string; models: string[] }>,
  ): string[] | null;
}
declare module "open-sse/services/accountFallback.js" {
  export const CONN_LOCK_COUNT_KEY = "lockCount";
  export const CONN_LOCK_REASON_KEY = "lockReason";
  export const CONN_LOCK_UNTIL_KEY = "lockUntil";
  export const MODEL_LOCK_COUNT_PREFIX = "modelLockCount_";
  export function buildConnectionLockUpdate(
    conn: Record<string, unknown> | undefined,
    errorText: string,
  ): { update: Record<string, unknown>; cooldownMs: number; newCount: number; until: string };
  export function buildModelLockUpdate(
    model: string | null,
    cooldownMs: number,
  ): Record<string, string>;
  export function checkFallbackError(
    status: number,
    errorText: string,
    backoffLevel: number,
  ): { shouldFallback: boolean; cooldownMs: number; newBackoffLevel: number };
  export function formatRetryAfter(iso: string): string;
  export function getConnectionLockUntil(conn: Record<string, unknown>): string | null;
  export function getEarliestModelLockUntil(conn: Record<string, unknown>): string | null;
  export function getModelLockCount(
    conn: Record<string, unknown> | undefined,
    model: string | null,
  ): number;
  export function getModelLockCountKey(model: string | null): string;
  export function isConnectionLevelError(status: number, errorText: string): boolean;
  export function isConnectionLockActive(conn: Record<string, unknown>): boolean;
  export function isModelLockActive(conn: Record<string, unknown>, model: string | null): boolean;
}
declare module "open-sse/services/model.js" {
  export interface ParsedModel {
    isAlias: boolean;
    provider: string | null;
    providerAlias: string;
    model: string;
  }
  export function getModelInfoCore(
    modelStr: string,
    getModelAliases: () => Promise<Record<string, unknown>>,
  ): Promise<{ provider: string; model: string }>;
  export function parseModel(modelStr: string): ParsedModel;
  export function resolveModelAliasFromMap(
    alias: string,
    aliases: Record<string, unknown>,
  ): { provider: string; model: string } | null;
}
declare module "open-sse/services/projectId.js" {
  export function getProjectIdForConnection(
    connectionId: string,
    accessToken: string,
  ): Promise<string | null>;
  export function invalidateProjectId(connectionId: string): void;
  export function removeConnection(connectionId: string): void;
}
declare module "open-sse/services/tokenRefresh.js" {
  export const TOKEN_EXPIRY_BUFFER_MS: number;
  export function getAccessToken(
    provider: string,
    credentials: Record<string, unknown>,
    log: unknown,
  ): Promise<Record<string, unknown>>;
  export function getRefreshLeadMs(provider: string): number;
  export function getAllAccessTokens(userInfo: unknown, log: unknown): unknown;
  export function formatProviderCredentials(
    provider: string,
    credentials: Record<string, unknown>,
    log: unknown,
  ): string;
  export function refreshAccessToken(
    provider: string,
    refreshToken: string,
    credentials: Record<string, unknown>,
    log: unknown,
  ): Promise<Record<string, unknown>>;
  export function refreshClaudeOAuthToken(
    refreshToken: string,
    log: unknown,
  ): Promise<Record<string, unknown>>;
  export function refreshCodexToken(
    refreshToken: string,
    log: unknown,
  ): Promise<Record<string, unknown>>;
  export function refreshCopilotToken(
    githubAccessToken: string,
    log?: unknown,
  ): Promise<{ token: string; expiresAt: number } | null>;
  export function refreshGitHubToken(
    refreshToken: string,
    log: unknown,
  ): Promise<Record<string, unknown>>;
  export function refreshGoogleToken(
    refreshToken: string,
    clientId: string,
    clientSecret: string,
    log: unknown,
  ): Promise<Record<string, unknown>>;
  export function refreshIflowToken(
    refreshToken: string,
    log: unknown,
  ): Promise<Record<string, unknown>>;
  export function refreshKiroToken(
    refreshToken: string,
    providerSpecificData: Record<string, unknown> | undefined,
    log: unknown,
  ): Promise<Record<string, unknown>>;
  export function refreshQwenToken(
    refreshToken: string,
    log: unknown,
  ): Promise<Record<string, unknown>>;
  export function refreshTokenByProvider(
    provider: string,
    credentials: Record<string, unknown>,
    log: unknown,
  ): Promise<Record<string, unknown>>;
}
declare module "open-sse/translator/formats.js" {
  export function detectFormatByEndpoint(pathname: string, body: Record<string, unknown>): string;
}
declare module "open-sse/utils/bypassHandler.js" {
  export interface BypassResult {
    response?: Response;
  }
  export function handleBypassRequest(
    body: Record<string, unknown>,
    model: string,
    userAgent: string,
    ccFilterNaming: boolean,
  ): BypassResult | Response | null;
}
declare module "open-sse/utils/claudeHeaderCache.js" {
  export function cacheClaudeHeaders(headers: Record<string, string>): void;
}
declare module "open-sse/utils/error.js" {
  export function errorResponse(
    status: number,
    message: string,
    headers?: Record<string, string>,
  ): Response;
  export function unavailableResponse(
    status: number,
    message: string,
    retryAfter: string | null,
    retryAfterHuman: string,
  ): Response;
}
