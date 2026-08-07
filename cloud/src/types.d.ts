type OpenSseJson = Record<string, unknown>;
type OpenSseLogger = {
  debug?: (tag: string, message: string, meta?: OpenSseJson) => void;
  info?: (tag: string, message: string, meta?: OpenSseJson) => void;
  warn?: (tag: string, message: string, meta?: OpenSseJson) => void;
  error?: (tag: string, message: string, meta?: OpenSseJson) => void;
};

type OpenSseCoreResult = {
  success: boolean;
  response: Response;
  status?: number;
  error?: string;
  resetsAtMs?: number;
};

// Workers compile must not typecheck the app-coupled open-sse source graph.
// The wildcard keeps bundling resolution intact while typing only cloud-used exports.
declare module "open-sse/*" {
  export type ChatCoreResult = OpenSseCoreResult;
  export type ChatCoreParams = {
    body: OpenSseJson;
    modelInfo: { provider: string; model: string };
    credentials: object | null;
    log: OpenSseLogger;
    onCredentialsRefreshed?: (newCreds: OpenSseJson) => Promise<void> | void;
    onRequestSuccess?: () => Promise<void> | void;
    onDisconnect?: (reason?: unknown) => Promise<void> | void;
    clientRawRequest?: unknown;
    connectionId?: string | null;
  };
  export type EmbeddingsResult = OpenSseCoreResult;
  export type EmbeddingsCoreParams = {
    body: OpenSseJson;
    modelInfo: { provider: string; model: string };
    credentials: object | null;
    log: OpenSseLogger;
    onCredentialsRefreshed?: (newCreds: OpenSseJson) => Promise<void> | void;
    onRequestSuccess?: () => Promise<void> | void;
  };
  export const MAX_RATE_LIMIT_COOLDOWN_MS: number;
  export const TOKEN_EXPIRY_BUFFER_MS: number;
  export const HTTP_STATUS: {
    BAD_REQUEST: 400;
    UNAUTHORIZED: 401;
    PAYMENT_REQUIRED: 402;
    FORBIDDEN: 403;
    NOT_FOUND: 404;
    NOT_ACCEPTABLE: 406;
    REQUEST_TIMEOUT: 408;
    RATE_LIMITED: 429;
    SERVER_ERROR: 500;
    BAD_GATEWAY: 502;
    SERVICE_UNAVAILABLE: 503;
    GATEWAY_TIMEOUT: 504;
  };
  export const ollamaModels: { models: OpenSseJson[] };
  export function initTranslators(): void;
  export function transformToOllama(response: Response, model: string): Response;
  export function getModelInfoCore(
    modelStr: string,
    modelAliases?: Record<string, string>,
  ): Promise<{ provider: string; model: string }> | { provider: string; model: string };
  export function handleChatCore(params: ChatCoreParams): Promise<ChatCoreResult>;
  export function handleEmbeddingsCore(params: EmbeddingsCoreParams): Promise<EmbeddingsResult>;
  export function errorResponse(statusCode: number, message: string): Response;
  export function checkFallbackError(
    status: number,
    errorText: string,
    backoffLevel?: number,
  ): { shouldFallback: boolean; cooldownMs: number; newBackoffLevel?: number };
  export function isAccountUnavailable(unavailableUntil?: string | null): boolean;
  export function getEarliestRateLimitedUntil(accounts: OpenSseJson[]): string | null;
  export function getUnavailableUntil(cooldownMs: number): string;
  export function formatRetryAfter(rateLimitedUntil?: string | null): string;
  export function getComboModelsFromData(model: string, combos: unknown[]): string[] | null;
  export function handleComboChat(params: {
    body: OpenSseJson;
    models: string[];
    handleSingleModel: (body: OpenSseJson, model: string) => Promise<Response>;
    log: OpenSseLogger;
    comboName?: string;
    comboStrategy?: string;
    comboStickyLimit?: number | string;
  }): Promise<Response>;
  export function refreshTokenByProvider(
    provider: string,
    credentials: object,
    log?: OpenSseLogger,
  ): Promise<OpenSseJson | null>;
}

interface RequestInitCfProperties {
  scrapeShield?: boolean;
  minify?: boolean | { javascript?: boolean; css?: boolean; html?: boolean };
  mirage?: boolean;
  polish?: string;
  [key: string]: unknown;
}
