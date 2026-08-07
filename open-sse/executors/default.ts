import { buildClineHeaders } from "../../src/shared/utils/clineAuth.mts";
import { buildKimiHeaders, OAUTH_ENDPOINTS } from "../config/appConstants.js";
import { PROVIDERS } from "../config/providers.js";
import { getCachedClaudeHeaders } from "../utils/claudeHeaderCache.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { injectReasoningContent } from "../utils/reasoningContentInjector.js";
import {
  BaseExecutor,
  type ExecutorCredentials,
  type ExecutorHeaders,
  type ExecutorLogger,
  type ExecutorProxyOptions,
} from "./base.js";

type JsonRecord = Record<string, unknown>;
type ChatMessage = JsonRecord & {
  content?: string | Array<string | { text?: unknown }>;
  role?: string;
};
type RefreshResult = {
  accessToken?: unknown;
  expiresIn?: unknown;
  refreshToken?: unknown;
};
type OAuthTokenPayload = {
  access_token?: unknown;
  expires_in?: unknown;
  refresh_token?: unknown;
};
type ClineRefreshPayload = {
  accessToken?: unknown;
  expiresAt?: unknown;
  refreshToken?: unknown;
};

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function asChatMessages(value: unknown): ChatMessage[] {
  return Array.isArray(value) ? (value as ChatMessage[]) : [];
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export class DefaultExecutor extends BaseExecutor {
  constructor(provider: string) {
    super(
      provider,
      (PROVIDERS as Record<string, typeof PROVIDERS.openai>)[provider] || PROVIDERS.openai,
    );
  }

  transformRequest(
    model: string,
    body: unknown,
    _stream?: boolean,
    _credentials?: ExecutorCredentials,
  ): unknown {
    let next = asRecord(body);
    const responseFormat = asRecord(next.response_format);
    const jsonSchema = asRecord(responseFormat.json_schema);
    // For openai-compatible-* providers (DeepSeek, Ollama, custom local LLMs, etc.) that don't
    // natively support Structured Output, fall back: inject the schema into the system prompt
    // and downgrade response_format to json_object so the model still produces valid JSON.
    // Native OpenAI / first-party providers keep their json_schema as-is.
    if (
      this.provider?.startsWith?.("openai-compatible-") &&
      responseFormat.type === "json_schema" &&
      jsonSchema.schema
    ) {
      const schema = jsonSchema.schema;
      const schemaName = asString(jsonSchema.name) || "response";
      const schemaInstruction = `You must respond with valid JSON matching this JSON schema ("${schemaName}"):
\`\`\`json
${JSON.stringify(schema, null, 2)}
\`\`\`
Respond ONLY with the JSON object, no other text.`;

      next = { ...next };
      next.response_format = { type: "json_object" };
      next.messages = [...asChatMessages(next.messages)];
      const messages = next.messages as ChatMessage[];

      // Prepend a system message (or merge into the first one) so the schema is in front.
      const firstSystemIdx = messages.findIndex((m) => m?.role === "system");
      if (firstSystemIdx === -1) {
        messages.unshift({ role: "system", content: schemaInstruction });
      } else {
        const sys = messages[firstSystemIdx];
        const existing =
          typeof sys.content === "string"
            ? sys.content
            : Array.isArray(sys.content)
              ? sys.content
                  .map((c) =>
                    typeof c === "string" ? c : typeof c?.text === "string" ? c.text : "",
                  )
                  .filter(Boolean)
                  .join("\n")
              : "";
        messages[firstSystemIdx] = {
          ...sys,
          content: existing ? `${existing}\n\n${schemaInstruction}` : schemaInstruction,
        };
      }
    }
    return injectReasoningContent({ provider: this.provider, model, body: next });
  }

  buildUrl(
    model: string,
    stream: boolean,
    urlIndex: number = 0,
    credentials: ExecutorCredentials | null = null,
  ): string | undefined {
    if (this.provider?.startsWith?.("openai-compatible-")) {
      const baseUrl = credentials?.providerSpecificData?.baseUrl || "https://api.openai.com/v1";
      const normalized = baseUrl.replace(/\/$/, "");
      const path = this.provider.includes("responses") ? "/responses" : "/chat/completions";
      return `${normalized}${path}`;
    }
    if (this.provider?.startsWith?.("anthropic-compatible-")) {
      const baseUrl = credentials?.providerSpecificData?.baseUrl || "https://api.anthropic.com/v1";
      const normalized = baseUrl.replace(/\/$/, "");
      return `${normalized}/messages`;
    }
    switch (this.provider) {
      case "claude":
      case "glm":
      case "kimi":
      case "minimax":
      case "minimax-cn":
        return `${this.config.baseUrl}?beta=true`;
      case "kimi-coding":
        return `${this.config.baseUrl}?beta=true`;
      case "gemini":
        return `${this.config.baseUrl}/${model}:${stream ? "streamGenerateContent?alt=sse" : "generateContent"}`;
      default: {
        const url = this.config.baseUrl;
        if (url?.includes("{accountId}")) {
          const accountId = credentials?.providerSpecificData?.accountId;
          if (!accountId)
            throw new Error(`${this.provider} requires accountId in providerSpecificData`);
          return url.replace("{accountId}", accountId);
        }
        return url;
      }
    }
  }

  buildHeaders(credentials: ExecutorCredentials, stream: boolean = true): ExecutorHeaders {
    const headers: ExecutorHeaders = {
      "Content-Type": "application/json",
      ...this.config.headers,
    };

    switch (this.provider) {
      case "gemini":
        if (credentials.apiKey) {
          headers["x-goog-api-key"] = credentials.apiKey;
        } else {
          headers["Authorization"] = `Bearer ${credentials.accessToken}`;
        }
        break;
      case "claude": {
        // Overlay live cached headers from real Claude Code client over static defaults.
        // Static headers (Title-Case) remain as cold-start fallback.
        const cached = getCachedClaudeHeaders();
        if (cached) {
          // Remove Title-Case static keys that conflict with incoming lowercase cached keys
          for (const lcKey of Object.keys(cached)) {
            // Build the Title-Case equivalent: "anthropic-version" → "Anthropic-Version"
            const titleKey = lcKey.replace(
              /(^|-)([a-z])/g,
              (_match: string, sep: string, c: string) => sep + c.toUpperCase(),
            );

            // Special handling for Anthropic-Beta to preserve required flags like OAuth
            if (lcKey === "anthropic-beta") {
              const staticBetaStr = headers[titleKey] || headers[lcKey] || "";
              const staticFlags = new Set(
                staticBetaStr
                  .split(",")
                  .map((f) => f.trim())
                  .filter(Boolean),
              );
              const cachedFlags = new Set(
                cached[lcKey]
                  .split(",")
                  .map((f) => f.trim())
                  .filter(Boolean),
              );

              // Merge all static flags (which contain oauth, thinking, etc) into the cached ones
              for (const flag of staticFlags) {
                cachedFlags.add(flag);
              }

              cached[lcKey] = Array.from(cachedFlags).join(",");
            }

            if (titleKey !== lcKey && headers[titleKey] !== undefined) {
              delete headers[titleKey];
            }
          }
          Object.assign(headers, cached);
        }
        if (credentials.apiKey) {
          headers["x-api-key"] = credentials.apiKey;
        } else {
          headers["Authorization"] = `Bearer ${credentials.accessToken}`;
        }
        break;
      }
      case "glm":
      case "kimi":
      case "minimax":
      case "minimax-cn":
        headers["x-api-key"] = credentials.apiKey || credentials.accessToken;
        break;
      case "kimi-coding":
        headers["Authorization"] = `Bearer ${credentials.accessToken}`;
        Object.assign(headers, buildKimiHeaders());
        break;
      default:
        if (this.provider?.startsWith?.("anthropic-compatible-")) {
          if (credentials.apiKey) {
            headers["x-api-key"] = credentials.apiKey;
          } else if (credentials.accessToken) {
            headers["Authorization"] = `Bearer ${credentials.accessToken}`;
          }
          if (!headers["anthropic-version"]) {
            headers["anthropic-version"] = "2023-06-01";
          }
        } else if (this.provider === "gitlab") {
          // GitLab Duo uses Bearer token (PAT with ai_features scope, or OAuth access token)
          headers["Authorization"] = `Bearer ${credentials.apiKey || credentials.accessToken}`;
        } else if (this.provider === "codebuddy") {
          headers["Authorization"] = `Bearer ${credentials.apiKey || credentials.accessToken}`;
        } else if (this.provider === "kilocode") {
          headers["Authorization"] = `Bearer ${credentials.apiKey || credentials.accessToken}`;
          if (credentials.providerSpecificData?.orgId) {
            headers["X-Kilocode-OrganizationID"] = credentials.providerSpecificData.orgId;
          }
        } else if (this.provider === "cline") {
          Object.assign(headers, buildClineHeaders(credentials.apiKey || credentials.accessToken));
        } else {
          headers["Authorization"] = `Bearer ${credentials.apiKey || credentials.accessToken}`;
        }
    }

    // Strip first-party Claude Code identity headers for non-Anthropic anthropic-compatible upstreams
    if (this.provider?.startsWith?.("anthropic-compatible-")) {
      const baseUrl = credentials?.providerSpecificData?.baseUrl || "";
      const isOfficialAnthropic = (() => {
        if (baseUrl === "") return true;
        try {
          const hostname = new URL(baseUrl).hostname;
          return hostname === "api.anthropic.com" || hostname.endsWith(".anthropic.com");
        } catch {
          return false;
        }
      })();
      if (!isOfficialAnthropic) {
        delete headers["anthropic-dangerous-direct-browser-access"];
        delete headers["Anthropic-Dangerous-Direct-Browser-Access"];
        delete headers["x-app"];
        delete headers["X-App"];
        // Strip claude-code-20250219 from Anthropic-Beta / anthropic-beta
        for (const betaKey of ["anthropic-beta", "Anthropic-Beta"]) {
          if (headers[betaKey]) {
            const filtered = headers[betaKey]
              .split(",")
              .map((s) => s.trim())
              .filter((f) => f && f !== "claude-code-20250219")
              .join(",");
            if (filtered) {
              headers[betaKey] = filtered;
            } else {
              delete headers[betaKey];
            }
          }
        }
      }
    }

    if (stream) headers["Accept"] = "text/event-stream";
    return headers;
  }

  async refreshCredentials(
    credentials: ExecutorCredentials,
    log: ExecutorLogger | null,
    proxyOptions: ExecutorProxyOptions = null,
  ): Promise<RefreshResult | null> {
    if (!credentials.refreshToken) return null;

    const refreshers: Record<string, () => Promise<RefreshResult | null>> = {
      claude: () =>
        this.refreshWithJSON(
          OAUTH_ENDPOINTS.anthropic.token,
          {
            grant_type: "refresh_token",
            refresh_token: credentials.refreshToken,
            client_id: PROVIDERS.claude.clientId,
          },
          proxyOptions,
        ),
      codex: () =>
        this.refreshWithForm(
          OAUTH_ENDPOINTS.openai.token,
          {
            grant_type: "refresh_token",
            refresh_token: credentials.refreshToken,
            client_id: PROVIDERS.codex.clientId,
            scope: "openid profile email offline_access",
          },
          proxyOptions,
        ),
      qwen: () =>
        this.refreshWithForm(
          OAUTH_ENDPOINTS.qwen.token,
          {
            grant_type: "refresh_token",
            refresh_token: credentials.refreshToken,
            client_id: PROVIDERS.qwen.clientId,
          },
          proxyOptions,
        ),
      iflow: () => this.refreshIflow(credentials.refreshToken, proxyOptions),
      gemini: () => this.refreshGoogle(credentials.refreshToken, proxyOptions),
      kiro: () => this.refreshKiro(credentials.refreshToken, proxyOptions),
      cline: () => this.refreshCline(credentials.refreshToken, proxyOptions),
      "kimi-coding": () => this.refreshKimiCoding(credentials.refreshToken, proxyOptions),
      kilocode: () => this.refreshKilocode(credentials.refreshToken, proxyOptions),
    };

    const refresher = refreshers[this.provider];
    if (!refresher) return null;

    try {
      const result = await refresher();
      if (result) log?.info?.("TOKEN", `${this.provider} refreshed`);
      return result;
    } catch (error: unknown) {
      log?.error?.(
        "TOKEN",
        `${this.provider} refresh error: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  async refreshWithJSON(
    url: string,
    body: JsonRecord,
    proxyOptions: ExecutorProxyOptions = null,
  ): Promise<RefreshResult | null> {
    const response = await proxyAwareFetch(
      url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body),
      },
      proxyOptions,
    );
    if (!response.ok) return null;
    const tokens = (await response.json()) as OAuthTokenPayload;
    return {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token || body.refresh_token,
      expiresIn: tokens.expires_in,
    };
  }

  async refreshWithForm(
    url: string,
    params: Record<string, string>,
    proxyOptions: ExecutorProxyOptions = null,
  ): Promise<RefreshResult | null> {
    const response = await proxyAwareFetch(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: new URLSearchParams(params),
      },
      proxyOptions,
    );
    if (!response.ok) return null;
    const tokens = (await response.json()) as OAuthTokenPayload;
    return {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token || params.refresh_token,
      expiresIn: tokens.expires_in,
    };
  }

  async refreshIflow(
    refreshToken: string,
    proxyOptions: ExecutorProxyOptions = null,
  ): Promise<RefreshResult | null> {
    if (!PROVIDERS.iflow.clientSecret) return null;

    const basicAuth = btoa(`${PROVIDERS.iflow.clientId}:${PROVIDERS.iflow.clientSecret}`);
    const response = await proxyAwareFetch(
      OAUTH_ENDPOINTS.iflow.token,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
          Authorization: `Basic ${basicAuth}`,
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
          client_id: PROVIDERS.iflow.clientId,
          client_secret: PROVIDERS.iflow.clientSecret,
        }),
      },
      proxyOptions,
    );
    if (!response.ok) return null;
    const tokens = (await response.json()) as OAuthTokenPayload;
    return {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token || refreshToken,
      expiresIn: tokens.expires_in,
    };
  }

  async refreshGoogle(
    refreshToken: string,
    proxyOptions: ExecutorProxyOptions = null,
  ): Promise<RefreshResult | null> {
    const response = await proxyAwareFetch(
      OAUTH_ENDPOINTS.google.token,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
          client_id: this.config.clientId || "",
          client_secret: this.config.clientSecret || "",
        }),
      },
      proxyOptions,
    );
    if (!response.ok) return null;
    const tokens = (await response.json()) as OAuthTokenPayload;
    return {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token || refreshToken,
      expiresIn: tokens.expires_in,
    };
  }

  async refreshKiro(
    refreshToken: string,
    proxyOptions: ExecutorProxyOptions = null,
  ): Promise<RefreshResult | null> {
    const response = await proxyAwareFetch(
      PROVIDERS.kiro.tokenUrl,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "User-Agent": "kiro-cli/1.0.0",
        },
        body: JSON.stringify({ refreshToken }),
      },
      proxyOptions,
    );
    if (!response.ok) return null;
    const tokens = (await response.json()) as {
      accessToken?: unknown;
      expiresIn?: unknown;
      refreshToken?: unknown;
    };
    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken || refreshToken,
      expiresIn: tokens.expiresIn,
    };
  }

  async refreshCline(
    refreshToken: string,
    proxyOptions: ExecutorProxyOptions = null,
  ): Promise<RefreshResult | null> {
    const response = await proxyAwareFetch(
      "https://api.cline.bot/api/v1/auth/refresh",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ refreshToken, grantType: "refresh_token", clientType: "extension" }),
      },
      proxyOptions,
    );
    if (!response.ok) {
      await response.text().catch(() => "");
      return null;
    }
    const payload = asRecord(await response.json());
    const data = asRecord(payload.data || payload) as ClineRefreshPayload;
    const expiresAtIso = data?.expiresAt;
    const expiresIn =
      typeof expiresAtIso === "string"
        ? Math.max(1, Math.floor((new Date(expiresAtIso).getTime() - Date.now()) / 1000))
        : undefined;
    return {
      accessToken: data?.accessToken,
      refreshToken: data?.refreshToken || refreshToken,
      expiresIn,
    };
  }

  async refreshKimiCoding(
    refreshToken: string,
    proxyOptions: ExecutorProxyOptions = null,
  ): Promise<RefreshResult | null> {
    const kimiHeaders = buildKimiHeaders();
    const response = await proxyAwareFetch(
      "https://auth.kimi.com/api/oauth/token",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
          ...kimiHeaders,
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
          client_id: "17e5f671-d194-4dfb-9706-5516cb48c098",
        }),
      },
      proxyOptions,
    );
    if (!response.ok) return null;
    const tokens = (await response.json()) as OAuthTokenPayload;
    return {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token || refreshToken,
      expiresIn: tokens.expires_in,
    };
  }

  async refreshKilocode(
    _refreshToken: string,
    _proxyOptions: ExecutorProxyOptions = null,
  ): Promise<null> {
    // Kilocode uses device code flow, no refresh token support
    return null;
  }
}

export default DefaultExecutor;
