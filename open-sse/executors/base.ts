import { DEFAULT_RETRY_CONFIG, HTTP_STATUS, resolveRetryEntry } from "../config/runtimeConfig.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";

const FETCH_CONNECT_TIMEOUT_MS = 15_000;

export type ExecutorHeaders = Record<string, string>;
export type ExecutorProviderData = {
  accountId?: string;
  apiVersion?: string;
  azureEndpoint?: string;
  baseUrl?: string;
  deployment?: string;
  machineId?: string;
  organization?: string;
  resourceUrl?: string;
  workspaceId?: string;
  [key: string]: unknown;
};
export type ExecutorCredentials = {
  accessToken?: string;
  apiKey?: string;
  connectionId?: string;
  copilotTokenExpiresAt?: string | number | Date;
  copilotToken?: string;
  email?: string;
  expiresIn?: string | number;
  expiresAt?: string | number | Date;
  projectId?: string;
  providerSpecificData?: ExecutorProviderData;
  rawHeaders?: Record<string, string>;
  refreshToken?: string;
  [key: string]: unknown;
};
export type RetryEntry =
  | number
  | {
      attempts?: number;
      delayMs?: number;
    }
  | null
  | undefined;
export type TransientRetryConfig = {
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
};
export type ExecutorConfigInput = {
  authUrl?: string;
  baseUrl?: string;
  baseUrls?: string[];
  chatPath?: string;
  clientId?: string | null;
  clientSecret?: string | null;
  format?: string;
  headers?: ExecutorHeaders;
  noAuth?: boolean;
  responsesUrl?: string;
  retry?: Record<string, RetryEntry>;
  tokenUrl?: string;
  transientRetry?: TransientRetryConfig;
  [key: string]: unknown;
};
export type ExecutorConfig = {
  authUrl?: string;
  baseUrl?: string;
  baseUrls?: string[];
  chatPath?: string;
  clientId?: string | null;
  clientSecret?: string | null;
  format?: string;
  headers: ExecutorHeaders;
  noAuth?: boolean;
  responsesUrl?: string;
  retry: Record<string, RetryEntry>;
  tokenUrl?: string;
  transientRetry?: TransientRetryConfig;
  [key: string]: unknown;
};
export type ExecutorLogger = {
  debug?: (scope: string, message: string) => void;
  error?: (scope: string, message: string) => void;
  info?: (scope: string, message: string) => void;
  warn?: (scope: string, message: string) => void;
};
export type ExecutorProxyOptions = Record<string, unknown> | null;
export type ExecutorExecuteOptions = {
  model: string;
  body: unknown;
  stream: boolean;
  credentials: ExecutorCredentials;
  signal?: AbortSignal;
  log?: ExecutorLogger;
  proxyOptions?: ExecutorProxyOptions;
  [key: string]: unknown;
};
export type ExecutorExecuteResult = {
  response: Response;
  url: string | undefined;
  headers: ExecutorHeaders;
  transformedBody: unknown;
};
export type ExecutorErrorDetails = {
  status: number;
  message: string;
  resetsAtMs?: number;
};

/**
 * BaseExecutor - Base class for provider executors
 */
export class BaseExecutor {
  provider: string;
  config: ExecutorConfig;
  noAuth: boolean;

  constructor(provider: string, config: ExecutorConfigInput) {
    this.provider = provider;
    this.config = {
      ...config,
      headers: config.headers || {},
      retry: config.retry || {},
    } as ExecutorConfig;
    this.noAuth = config.noAuth || false;
  }

  getProvider(): string {
    return this.provider;
  }

  getBaseUrls(): string[] {
    return this.config.baseUrls || (this.config.baseUrl ? [this.config.baseUrl] : []);
  }

  getFallbackCount(): number {
    return this.getBaseUrls().length || 1;
  }

  buildUrl(
    model: string,
    stream: boolean,
    urlIndex: number = 0,
    credentials: ExecutorCredentials | null = null,
  ): string | undefined {
    if (this.provider.startsWith("openai-compatible-")) {
      const baseUrl = credentials?.providerSpecificData?.baseUrl || "https://api.openai.com/v1";
      const normalized = baseUrl.replace(/\/$/, "");
      const path = this.provider.includes("responses") ? "/responses" : "/chat/completions";
      return `${normalized}${path}`;
    }
    if (this.provider.startsWith("anthropic-compatible-")) {
      const baseUrl = credentials?.providerSpecificData?.baseUrl || "https://api.anthropic.com/v1";
      const normalized = baseUrl.replace(/\/$/, "");
      return `${normalized}/messages`;
    }
    const baseUrls = this.getBaseUrls();
    return baseUrls[urlIndex] || baseUrls[0] || this.config.baseUrl;
  }

  buildHeaders(credentials: ExecutorCredentials, stream: boolean = true): ExecutorHeaders {
    const headers: ExecutorHeaders = {
      "Content-Type": "application/json",
      ...this.config.headers,
    };

    if (this.provider.startsWith("anthropic-compatible-")) {
      // Anthropic-compatible providers use x-api-key header
      if (credentials.apiKey) {
        headers["x-api-key"] = credentials.apiKey;
      } else if (credentials.accessToken) {
        headers["Authorization"] = `Bearer ${credentials.accessToken}`;
      }
      if (!headers["anthropic-version"]) {
        headers["anthropic-version"] = "2023-06-01";
      }
    } else {
      // Standard Bearer token auth for other providers
      if (credentials.accessToken) {
        headers["Authorization"] = `Bearer ${credentials.accessToken}`;
      } else if (credentials.apiKey) {
        headers["Authorization"] = `Bearer ${credentials.apiKey}`;
      }
    }

    if (stream) {
      headers["Accept"] = "text/event-stream";
    }

    return headers;
  }

  // Override in subclass for provider-specific transformations
  transformRequest(
    model: string,
    body: unknown,
    _stream: boolean,
    _credentials: ExecutorCredentials,
  ): unknown {
    return body;
  }

  shouldRetry(status: number, urlIndex: number): boolean {
    return (
      [
        HTTP_STATUS.RATE_LIMITED,
        HTTP_STATUS.BAD_GATEWAY,
        HTTP_STATUS.SERVICE_UNAVAILABLE,
        HTTP_STATUS.GATEWAY_TIMEOUT,
      ].includes(status) && urlIndex + 1 < this.getFallbackCount()
    );
  }

  // Override in subclass for provider-specific refresh
  async refreshCredentials(
    credentials: ExecutorCredentials,
    log: ExecutorLogger | null,
    proxyOptions: ExecutorProxyOptions = null,
  ): Promise<ExecutorCredentials | null> {
    void credentials;
    void log;
    void proxyOptions;
    return null;
  }

  needsRefresh(credentials: ExecutorCredentials): boolean {
    if (!credentials.expiresAt) return false;
    const expiresAtMs = new Date(credentials.expiresAt).getTime();
    return expiresAtMs - Date.now() < 5 * 60 * 1000;
  }

  parseError(response: Response, bodyText: string): ExecutorErrorDetails {
    return { status: response.status, message: bodyText || `HTTP ${response.status}` };
  }

  async execute({
    model,
    body,
    stream,
    credentials,
    signal,
    log,
    proxyOptions = null,
  }: ExecutorExecuteOptions): Promise<ExecutorExecuteResult> {
    const fallbackCount = this.getFallbackCount();
    let lastError: unknown = null;
    let lastStatus = 0;
    const retryAttemptsByUrl: Record<number, number> = {};

    // Merge default retry config with provider-specific config
    const retryConfig: Record<string, RetryEntry> = {
      ...DEFAULT_RETRY_CONFIG,
      ...this.config.retry,
    };

    // Schedule retry via retryConfig[statusKey]. Returns true when caller should `urlIndex--; continue`
    const tryRetry = async (
      urlIndex: number,
      statusKey: number,
      reason: string,
    ): Promise<boolean> => {
      const { attempts, delayMs } = resolveRetryEntry(retryConfig[String(statusKey)]);
      const previousAttempts = retryAttemptsByUrl[urlIndex] || 0;
      if (attempts <= 0 || previousAttempts >= attempts) return false;
      const nextAttempts = previousAttempts + 1;
      retryAttemptsByUrl[urlIndex] = nextAttempts;
      log?.debug?.("RETRY", `${reason} retry ${nextAttempts}/${attempts} after ${delayMs / 1000}s`);
      await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
      return true;
    };

    for (let urlIndex = 0; urlIndex < fallbackCount; urlIndex++) {
      const url = this.buildUrl(model, stream, urlIndex, credentials);
      const transformedBody = this.transformRequest(model, body, stream, credentials);
      const headers = this.buildHeaders(credentials, stream);

      if (!retryAttemptsByUrl[urlIndex]) retryAttemptsByUrl[urlIndex] = 0;

      // Abort if upstream doesn't return response headers within FETCH_CONNECT_TIMEOUT_MS
      const connectCtrl = new AbortController();
      const connectTimer = setTimeout(
        () => connectCtrl.abort(new Error("fetch connect timeout")),
        FETCH_CONNECT_TIMEOUT_MS,
      );
      const mergedSignal = signal
        ? AbortSignal.any([signal, connectCtrl.signal])
        : connectCtrl.signal;

      try {
        const response = await proxyAwareFetch(
          url,
          {
            method: "POST",
            headers,
            body: JSON.stringify(transformedBody),
            signal: mergedSignal,
          },
          proxyOptions,
        );
        clearTimeout(connectTimer);

        if (await tryRetry(urlIndex, response.status, `status ${response.status}`)) {
          urlIndex--;
          continue;
        }

        if (this.shouldRetry(response.status, urlIndex)) {
          log?.debug?.("RETRY", `${response.status} on ${url}, trying fallback ${urlIndex + 1}`);
          lastStatus = response.status;
          continue;
        }

        return { response, url, headers, transformedBody };
      } catch (error: unknown) {
        clearTimeout(connectTimer);
        lastError = error;
        const errorName = error instanceof Error ? error.name : "";
        const errorMessage = error instanceof Error ? error.message : String(error);
        const isConnectTimeout = connectCtrl.signal.aborted && errorName === "AbortError";
        // Connect timeout is internal — convert to retryable network error, don't propagate AbortError
        if (errorName === "AbortError" && !isConnectTimeout) throw error;

        // Map network/fetch exceptions to 502 retry config
        if (await tryRetry(urlIndex, HTTP_STATUS.BAD_GATEWAY, `network "${errorMessage}"`)) {
          urlIndex--;
          continue;
        }

        if (urlIndex + 1 < fallbackCount) {
          log?.debug?.("RETRY", `Error on ${url}, trying fallback ${urlIndex + 1}`);
          continue;
        }
        throw error;
      }
    }

    throw lastError || new Error(`All ${fallbackCount} URLs failed with status ${lastStatus}`);
  }
}

export default BaseExecutor;
