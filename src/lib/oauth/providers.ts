/**
 * OAuth Provider Configurations and Handlers
 * Centralized DRY approach for all OAuth providers
 */

// Ensure outbound fetch respects HTTP(S)_PROXY/ALL_PROXY in Node runtime
import "open-sse/index.js";

import {
  ANTIGRAVITY_CONFIG,
  CLAUDE_CONFIG,
  CLINE_CONFIG,
  CODEBUDDY_CONFIG,
  CODEX_CONFIG,
  CURSOR_CONFIG,
  GEMINI_CONFIG,
  GITHUB_CONFIG,
  GITLAB_CONFIG,
  getOAuthClientMetadata,
  IFLOW_CONFIG,
  KILOCODE_CONFIG,
  KIMI_CODING_CONFIG,
  KIRO_CONFIG,
  QODER_CONFIG,
  QWEN_CONFIG,
} from "./constants/oauth";
import { generatePKCE } from "./utils/pkce";

const BASE64_BLOCK_SIZE = 4;

function decodeJwtPayload(jwt: string | null | undefined): Record<string, unknown> | null {
  try {
    if (!jwt || typeof jwt !== "string") return null;
    const parts = jwt.split(".");
    if (parts.length !== 3) return null;
    const base64 = parts[1]!.replace(/-/g, "+").replace(/_/g, "/");
    const missingPadding =
      (BASE64_BLOCK_SIZE - (base64.length % BASE64_BLOCK_SIZE)) % BASE64_BLOCK_SIZE;
    const padded = base64 + "=".repeat(missingPadding);
    return JSON.parse(Buffer.from(padded, "base64").toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function extractEmailFromAccessToken(accessToken: string | null | undefined): string | undefined {
  const payload = decodeJwtPayload(accessToken);
  if (!payload) return undefined;
  const email = payload.email;
  const preferredUsername = payload.preferred_username;
  const sub = payload.sub;
  return (
    (typeof email === "string" ? email : undefined) ||
    (typeof preferredUsername === "string" ? preferredUsername : undefined) ||
    (typeof sub === "string" ? sub : undefined)
  );
}

export type CodexAccountInfo = {
  email?: string;
  chatgptAccountId?: string;
  chatgptPlanType?: string;
};

// Extract codex account info from id_token
export function extractCodexAccountInfo(idToken: string | null | undefined): CodexAccountInfo {
  const payload = decodeJwtPayload(idToken);
  if (!payload) return {};
  const chatgpt =
    (payload["https://api.openai.com/auth"] as Record<string, unknown> | undefined) || {};
  return {
    email: typeof payload.email === "string" ? payload.email : undefined,
    chatgptAccountId:
      typeof chatgpt.chatgpt_account_id === "string" ? chatgpt.chatgpt_account_id : undefined,
    chatgptPlanType:
      typeof chatgpt.chatgpt_plan_type === "string" ? chatgpt.chatgpt_plan_type : undefined,
  };
}

// Each provider has a different config shape. The provider handlers access
// fields by name (e.g. `config.clientId!`, `config.scopes!`, `config.tokenUrl!`).
// We type the union so providers get exhaustive narrowing only where they
// handle a specific config type. For functions that need to touch any
// provider's config, `AnyConfig` exposes the common string fields.
type AnyConfig = {
  clientId?: string;
  clientSecret?: string;
  scopes?: string[] | string;
  scope?: string;
  codeChallengeMethod?: string;
  extraParams?: Record<string, string>;
  authorizeUrl?: string;
  authorizeUrlPath?: string;
  tokenUrl?: string;
  tokenUrlPath?: string;
  userInfoUrl?: string;
  deviceCodeUrl?: string;
  startUrl?: string;
  clientName?: string;
  clientType?: string;
  grantTypes?: string[];
  issuerUrl?: string;
  apiBaseUrl?: string;
  initiateUrl?: string;
  pollUrlBase?: string;
  stateUrl?: string;
  userAgent?: string;
  platform?: string;
  pollInterval?: number;
  defaultBaseUrl?: string;
  loadCodeAssistUserAgent?: string;
  loadCodeAssistApiClient?: string;
  loadCodeAssistClientMetadata?: string;
  loadCodeAssistEndpoint?: string;
  onboardUserEndpoint?: string;
  [key: string]: unknown;
};

type DeviceCodeResponse = {
  device_code: string;
  user_code?: string;
  verification_uri?: string;
  verification_uri_complete?: string;
  verificationUri?: string;
  verificationUriComplete?: string;
  expires_in?: number;
  expiresIn?: number;
  interval?: number;
  code?: string;
  verificationUrl?: string;
  state?: string;
  authUrl?: string;
  _clientId?: string;
  _clientSecret?: string;
  _region?: string;
  _authMethod?: string;
  _startUrl?: string;
  _isCodeBuddy?: boolean;
};

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  id_token?: string;
  resource_url?: string;
  accessToken?: string;
  refreshToken?: string;
  expiresIn?: number;
  expiresAt?: string;
  expires_at?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  machineId?: string;
  profile_arn?: string;
  profileArn?: string;
  _clientId?: string;
  _clientSecret?: string;
  _region?: string;
  _authMethod?: string;
  _startUrl?: string;
  _user?: Record<string, unknown>;
  _baseUrl?: string;
  _userEmail?: string;
  _orgId?: string;
};

type PollResult = { ok: boolean; data: Record<string, unknown> & { access_token?: string } };

type ExtraResult = {
  userInfo?: Record<string, unknown>;
  projectId?: string;
  copilotToken?: Record<string, unknown>;
};

type AuthMeta = Record<string, unknown>;

type BuildAuthUrl = (
  config: AnyConfig,
  redirectUri: string,
  state: string,
  codeChallenge: string | undefined,
  meta?: AuthMeta,
) => string;

type ExchangeToken = (
  config: AnyConfig,
  code: string,
  redirectUri: string,
  codeVerifier: string,
  state?: string,
  meta?: AuthMeta,
) => Promise<TokenResponse>;

type RequestDeviceCode = (
  config: AnyConfig,
  codeChallenge: string | undefined,
  options?: AuthMeta,
) => Promise<DeviceCodeResponse>;

type PollToken = (
  config: AnyConfig,
  deviceCode: string,
  codeVerifier: string | undefined,
  extraData?: AuthMeta,
) => Promise<PollResult>;

type PostExchange = (tokens: TokenResponse) => Promise<ExtraResult>;

type MapTokens = (tokens: TokenResponse, extra?: ExtraResult | null) => Record<string, unknown>;

type ProviderHandler = {
  config: AnyConfig;
  flowType: "authorization_code" | "authorization_code_pkce" | "device_code" | "import_token";
  fixedPort?: number;
  callbackPath?: string;
  buildAuthUrl?: BuildAuthUrl;
  exchangeToken?: ExchangeToken;
  requestDeviceCode?: RequestDeviceCode;
  pollToken?: PollToken;
  postExchange?: PostExchange;
  mapTokens: MapTokens;
};

// Provider configurations
const PROVIDERS: Record<string, ProviderHandler> = {
  claude: {
    config: CLAUDE_CONFIG,
    flowType: "authorization_code_pkce",
    buildAuthUrl: (config, redirectUri, state, codeChallenge) => {
      const params = new URLSearchParams({
        code: "true",
        client_id: config.clientId!,
        response_type: "code",
        redirect_uri: redirectUri,
        scope: Array.isArray(config.scopes!) ? config.scopes!.join(" ") : config.scopes!,
        code_challenge: codeChallenge ?? "",
        code_challenge_method: config.codeChallengeMethod!,
        state: state,
      });
      return `${config.authorizeUrl!}?${params.toString()}`;
    },
    exchangeToken: async (config, code, redirectUri, codeVerifier, state) => {
      let authCode = code;
      let codeState = "";
      if (authCode.includes("#")) {
        const parts = authCode.split("#");
        authCode = parts[0] || "";
        codeState = parts[1] || "";
      }

      const response = await fetch(config.tokenUrl!, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          code: authCode,
          state: codeState || state,
          grant_type: "authorization_code",
          client_id: config.clientId!,
          redirect_uri: redirectUri,
          code_verifier: codeVerifier,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Token exchange failed: ${error}`);
      }

      return (await response.json()) as TokenResponse;
    },
    mapTokens: (tokens) => ({
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresIn: tokens.expires_in,
      scope: tokens.scope,
    }),
  },

  codex: {
    config: CODEX_CONFIG,
    flowType: "authorization_code_pkce",
    fixedPort: 1455,
    callbackPath: "/auth/callback",
    buildAuthUrl: (config, redirectUri, state, codeChallenge, _meta) => {
      const params: Record<string, string> = {
        response_type: "code",
        client_id: config.clientId!,
        redirect_uri: redirectUri,
        scope: config.scope!,
        code_challenge: codeChallenge ?? "",
        code_challenge_method: config.codeChallengeMethod!,
        ...config.extraParams,
        state: state,
      };
      const queryString = Object.entries(params)
        .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
        .join("&");
      return `${config.authorizeUrl!}?${queryString}`;
    },
    exchangeToken: async (config, code, redirectUri, codeVerifier) => {
      const response = await fetch(config.tokenUrl!, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: config.clientId!,
          code: code,
          redirect_uri: redirectUri,
          code_verifier: codeVerifier,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Token exchange failed: ${error}`);
      }

      return (await response.json()) as TokenResponse;
    },
    mapTokens: (tokens) => {
      const info = extractCodexAccountInfo(tokens.id_token);
      const mapped: Record<string, unknown> = {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresIn: tokens.expires_in,
      };
      if (info.email) mapped.email = info.email;
      if (info.chatgptAccountId || info.chatgptPlanType) {
        mapped.providerSpecificData = {
          chatgptAccountId: info.chatgptAccountId,
          chatgptPlanType: info.chatgptPlanType,
        };
      }
      return mapped;
    },
  },

  "gemini-cli": {
    config: GEMINI_CONFIG,
    flowType: "authorization_code",
    buildAuthUrl: (config, redirectUri, state) => {
      const params = new URLSearchParams({
        client_id: config.clientId!,
        response_type: "code",
        redirect_uri: redirectUri,
        scope: Array.isArray(config.scopes!) ? config.scopes!.join(" ") : config.scopes!,
        state: state,
        access_type: "offline",
        prompt: "consent",
      });
      return `${config.authorizeUrl!}?${params.toString()}`;
    },
    exchangeToken: async (config, code, redirectUri) => {
      const response = await fetch(config.tokenUrl!, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: config.clientId!,
          client_secret: config.clientSecret!,
          code: code,
          redirect_uri: redirectUri,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Token exchange failed: ${error}`);
      }

      return (await response.json()) as TokenResponse;
    },
    postExchange: async (tokens) => {
      const userInfoRes = await fetch(`${GEMINI_CONFIG.userInfoUrl}?alt=json`, {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      const userInfo = userInfoRes.ok
        ? ((await userInfoRes.json()) as Record<string, unknown>)
        : {};

      let projectId = "";
      try {
        const projectRes = await fetch(
          "https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${tokens.access_token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              metadata: getOAuthClientMetadata(),
              mode: 1,
            }),
          },
        );
        if (projectRes.ok) {
          const data = (await projectRes.json()) as {
            cloudaicompanionProject?: { id?: string } | string;
          };
          projectId =
            (typeof data.cloudaicompanionProject === "object"
              ? data.cloudaicompanionProject?.id
              : data.cloudaicompanionProject) || "";
        }
      } catch (e) {
        console.log("Failed to fetch project ID:", e);
      }

      return { userInfo, projectId };
    },
    mapTokens: (tokens, extra) => ({
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresIn: tokens.expires_in,
      scope: tokens.scope,
      email: extra?.userInfo?.email as string | undefined,
      projectId: extra?.projectId,
    }),
  },

  antigravity: {
    config: ANTIGRAVITY_CONFIG,
    flowType: "authorization_code",
    buildAuthUrl: (config, redirectUri, state) => {
      const params = new URLSearchParams({
        client_id: config.clientId!,
        response_type: "code",
        redirect_uri: redirectUri,
        scope: Array.isArray(config.scopes!) ? config.scopes!.join(" ") : config.scopes!,
        state: state,
        access_type: "offline",
        prompt: "consent",
      });
      return `${config.authorizeUrl!}?${params.toString()}`;
    },
    exchangeToken: async (config, code, redirectUri) => {
      const response = await fetch(config.tokenUrl!, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: config.clientId!,
          client_secret: config.clientSecret!,
          code: code,
          redirect_uri: redirectUri,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Token exchange failed: ${error}`);
      }

      return (await response.json()) as TokenResponse;
    },
    postExchange: async (tokens) => {
      const loadHeaders: Record<string, string> = {
        Authorization: `Bearer ${tokens.access_token}`,
        "Content-Type": "application/json",
        "User-Agent": ANTIGRAVITY_CONFIG.loadCodeAssistUserAgent,
        "X-Goog-Api-Client": ANTIGRAVITY_CONFIG.loadCodeAssistApiClient,
        "Client-Metadata": ANTIGRAVITY_CONFIG.loadCodeAssistClientMetadata,
        "x-request-source": "local",
      };
      const metadata = {
        ideType: "IDE_UNSPECIFIED",
        platform: "PLATFORM_UNSPECIFIED",
        pluginType: "GEMINI",
      };

      const userInfoRes = await fetch(`${ANTIGRAVITY_CONFIG.userInfoUrl}?alt=json`, {
        headers: {
          Authorization: `Bearer ${tokens.access_token}`,
          "x-request-source": "local",
        },
      });
      const userInfo = userInfoRes.ok
        ? ((await userInfoRes.json()) as Record<string, unknown>)
        : {};

      let projectId = "";
      let tierId = "legacy-tier";
      try {
        const loadRes = await fetch(ANTIGRAVITY_CONFIG.loadCodeAssistEndpoint, {
          method: "POST",
          headers: loadHeaders,
          body: JSON.stringify({ metadata }),
        });
        if (loadRes.ok) {
          const data = (await loadRes.json()) as {
            cloudaicompanionProject?: { id?: string } | string;
            allowedTiers?: Array<{ isDefault?: boolean; id?: string }>;
          };
          projectId =
            (typeof data.cloudaicompanionProject === "object"
              ? data.cloudaicompanionProject?.id
              : data.cloudaicompanionProject) || "";
          if (Array.isArray(data.allowedTiers)) {
            for (const tier of data.allowedTiers) {
              if (tier.isDefault && tier.id) {
                tierId = tier.id.trim();
                break;
              }
            }
          }
        }
      } catch (e) {
        console.log("Failed to load code assist:", e);
      }

      if (projectId) {
        const doOnboard = async (): Promise<void> => {
          for (let i = 0; i < 10; i++) {
            try {
              const onboardRes = await fetch(ANTIGRAVITY_CONFIG.onboardUserEndpoint, {
                method: "POST",
                headers: loadHeaders,
                body: JSON.stringify({ tierId, metadata }),
              });
              if (onboardRes.ok) {
                const result = (await onboardRes.json()) as { done?: boolean };
                if (result.done === true) break;
              }
            } catch {
              break;
            }
            await new Promise((resolve) => setTimeout(resolve, 5000));
          }
        };
        doOnboard().catch(() => {});
      }

      return { userInfo, projectId };
    },
    mapTokens: (tokens, extra) => ({
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresIn: tokens.expires_in,
      scope: tokens.scope,
      email: extra?.userInfo?.email as string | undefined,
      projectId: extra?.projectId,
    }),
  },

  iflow: {
    config: IFLOW_CONFIG as unknown as AnyConfig,
    flowType: "authorization_code",
    buildAuthUrl: (config, redirectUri, state) => {
      if (!config.clientSecret!) {
        throw new Error("Missing IFLOW_OAUTH_CLIENT_SECRET");
      }

      const params = new URLSearchParams({
        loginMethod: config.extraParams?.loginMethod as string,
        type: config.extraParams?.type as string,
        redirect: redirectUri,
        state: state,
        client_id: config.clientId!,
      });
      return `${config.authorizeUrl!}?${params.toString()}`;
    },
    exchangeToken: async (config, code, redirectUri) => {
      if (!config.clientSecret!) {
        throw new Error("Missing IFLOW_OAUTH_CLIENT_SECRET");
      }

      const basicAuth = Buffer.from(`${config.clientId!}:${config.clientSecret!}`).toString(
        "base64",
      );

      const response = await fetch(config.tokenUrl!, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
          Authorization: `Basic ${basicAuth}`,
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code: code,
          redirect_uri: redirectUri,
          client_id: config.clientId!,
          client_secret: config.clientSecret!,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Token exchange failed: ${error}`);
      }

      return (await response.json()) as TokenResponse;
    },
    postExchange: async (tokens) => {
      const userInfoRes = await fetch(
        `${IFLOW_CONFIG.userInfoUrl}?accessToken=${encodeURIComponent(tokens.access_token ?? "")}`,
        {
          headers: {
            Accept: "application/json",
          },
        },
      );

      if (!userInfoRes.ok) {
        const errorText = await userInfoRes.text();
        throw new Error(`Failed to fetch user info: ${errorText}`);
      }

      const result = (await userInfoRes.json()) as {
        success?: boolean;
        message?: string;
        data?: {
          apiKey?: string;
          email?: string;
          phone?: string;
          nickname?: string;
          name?: string;
        };
      };
      if (!result.success) {
        throw new Error(`User info request failed: ${result.message || "Unknown error"}`);
      }

      const userInfo = result.data || {};
      if (!userInfo.apiKey || userInfo.apiKey.trim() === "") {
        throw new Error("Empty API key returned from iFlow");
      }

      const email = userInfo.email?.trim() || userInfo.phone?.trim();
      if (!email) {
        throw new Error("Missing account email/phone in user info");
      }

      return { userInfo };
    },
    mapTokens: (tokens, extra) => ({
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresIn: tokens.expires_in,
      apiKey: extra?.userInfo?.apiKey,
      email: extra?.userInfo?.email || extra?.userInfo?.phone,
      displayName: extra?.userInfo?.nickname || extra?.userInfo?.name,
    }),
  },

  qoder: {
    config: QODER_CONFIG as unknown as AnyConfig,
    flowType: "authorization_code",
    buildAuthUrl: (config, redirectUri, state) => {
      if (!config.clientId! || !config.clientSecret!) {
        throw new Error("Missing QODER OAuth client credentials");
      }

      const params = new URLSearchParams({
        client_id: config.clientId!,
        response_type: "code",
        redirect_uri: redirectUri,
        state: state,
      });
      return `${config.authorizeUrl!}?${params.toString()}`;
    },
    exchangeToken: async (config, code, redirectUri) => {
      if (!config.clientId! || !config.clientSecret!) {
        throw new Error("Missing QODER OAuth client credentials");
      }

      const basicAuth = Buffer.from(`${config.clientId!}:${config.clientSecret!}`).toString(
        "base64",
      );

      const response = await fetch(config.tokenUrl!, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
          Authorization: `Basic ${basicAuth}`,
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code: code,
          redirect_uri: redirectUri,
          client_id: config.clientId!,
          client_secret: config.clientSecret!,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Token exchange failed: ${error}`);
      }

      return (await response.json()) as TokenResponse;
    },
    postExchange: async (tokens) => {
      const userInfoRes = await fetch(
        `${QODER_CONFIG.userInfoUrl}?accessToken=${encodeURIComponent(tokens.access_token ?? "")}`,
        { headers: { Accept: "application/json" } },
      );

      if (!userInfoRes.ok) {
        const errorText = await userInfoRes.text();
        throw new Error(`Failed to fetch user info: ${errorText}`);
      }

      const result = (await userInfoRes.json()) as {
        success?: boolean;
        message?: string;
        data?: {
          apiKey?: string;
          email?: string;
          phone?: string;
          nickname?: string;
          name?: string;
        };
      };
      if (!result.success) {
        throw new Error(`User info request failed: ${result.message || "Unknown error"}`);
      }

      const userInfo = result.data || {};
      if (!userInfo.apiKey || userInfo.apiKey.trim() === "") {
        throw new Error("Empty API key returned from Qoder");
      }

      const email = userInfo.email?.trim() || userInfo.phone?.trim();
      if (!email) {
        throw new Error("Missing account email/phone in user info");
      }

      return { userInfo };
    },
    mapTokens: (tokens, extra) => ({
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresIn: tokens.expires_in,
      apiKey: extra?.userInfo?.apiKey,
      email: extra?.userInfo?.email || extra?.userInfo?.phone,
      displayName: extra?.userInfo?.nickname || extra?.userInfo?.name,
    }),
  },

  qwen: {
    config: QWEN_CONFIG,
    flowType: "device_code",
    requestDeviceCode: async (config, codeChallenge) => {
      const response = await fetch(config.deviceCodeUrl!, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: new URLSearchParams({
          client_id: config.clientId!,
          scope: config.scope!,
          code_challenge: codeChallenge ?? "",
          code_challenge_method: config.codeChallengeMethod!,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Device code request failed: ${error}`);
      }

      return (await response.json()) as DeviceCodeResponse;
    },
    pollToken: async (config, deviceCode, codeVerifier) => {
      const response = await fetch(config.tokenUrl!, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: new URLSearchParams({
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          client_id: config.clientId!,
          device_code: deviceCode,
          code_verifier: codeVerifier ?? "",
        }),
      });

      return {
        ok: response.ok,
        data: ((await response.json()) as Record<string, unknown>) || {},
      };
    },
    mapTokens: (tokens) => ({
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresIn: tokens.expires_in,
      providerSpecificData: { resourceUrl: tokens.resource_url },
    }),
  },

  github: {
    config: GITHUB_CONFIG,
    flowType: "device_code",
    requestDeviceCode: async (config) => {
      const response = await fetch(config.deviceCodeUrl!, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: new URLSearchParams({
          client_id: config.clientId! ?? "",
          scope: String(config.scopes!),
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Device code request failed: ${error}`);
      }

      return (await response.json()) as DeviceCodeResponse;
    },
    pollToken: async (config, deviceCode) => {
      const response = await fetch(config.tokenUrl!, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: new URLSearchParams({
          client_id: config.clientId!,
          device_code: deviceCode,
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        }),
      });

      let data: Record<string, unknown>;
      try {
        data = (await response.json()) as Record<string, unknown>;
      } catch {
        const text = await response.text();
        data = { error: "invalid_response", error_description: text };
      }

      return { ok: response.ok, data };
    },
    postExchange: async (tokens) => {
      const copilotRes = await fetch(GITHUB_CONFIG.copilotTokenUrl, {
        headers: {
          Authorization: `Bearer ${tokens.access_token ?? ""}`,
          Accept: "application/json",
          "X-GitHub-Api-Version": GITHUB_CONFIG.apiVersion,
          "User-Agent": GITHUB_CONFIG.userAgent,
        },
      });
      const copilotToken = copilotRes.ok
        ? ((await copilotRes.json()) as Record<string, unknown>)
        : {};

      const userRes = await fetch(GITHUB_CONFIG.userInfoUrl, {
        headers: {
          Authorization: `Bearer ${tokens.access_token ?? ""}`,
          Accept: "application/json",
          "X-GitHub-Api-Version": GITHUB_CONFIG.apiVersion,
          "User-Agent": GITHUB_CONFIG.userAgent,
        },
      });
      const userInfo = userRes.ok ? ((await userRes.json()) as Record<string, unknown>) : {};

      return { copilotToken, userInfo };
    },
    mapTokens: (tokens, extra) => ({
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresIn: tokens.expires_in,
      providerSpecificData: {
        copilotToken: (extra?.copilotToken as { token?: string } | undefined)?.token,
        copilotTokenExpiresAt: (extra?.copilotToken as { expires_at?: number } | undefined)
          ?.expires_at,
        githubUserId: (extra?.userInfo as { id?: number } | undefined)?.id,
        githubLogin: (extra?.userInfo as { login?: string } | undefined)?.login,
        githubName: (extra?.userInfo as { name?: string } | undefined)?.name,
        githubEmail: (extra?.userInfo as { email?: string } | undefined)?.email,
      },
    }),
  },

  kiro: {
    config: KIRO_CONFIG,
    flowType: "device_code",
    requestDeviceCode: async (config, codeChallenge, options = {}) => {
      const trimmedRegion = typeof options.region === "string" ? options.region.trim() : "";
      const region = trimmedRegion || "us-east-1";
      const trimmedStartUrl = typeof options.startUrl === "string" ? options.startUrl.trim() : "";
      const startUrl = trimmedStartUrl || config.startUrl;
      const authMethod = options.authMethod === "idc" ? "idc" : "builder-id";
      const registerClientUrl = `https://oidc.${region}.amazonaws.com/client/register`;
      const deviceAuthUrl = `https://oidc.${region}.amazonaws.com/device_authorization`;

      const registerRes = await fetch(registerClientUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          clientName: config.clientName,
          clientType: config.clientType,
          scopes: config.scopes!,
          grantTypes: config.grantTypes,
          issuerUrl: config.issuerUrl,
        }),
      });

      if (!registerRes.ok) {
        const error = await registerRes.text();
        throw new Error(`Client registration failed: ${error}`);
      }

      const clientInfo = (await registerRes.json()) as {
        clientId: string;
        clientSecret: string;
      };

      const deviceRes = await fetch(deviceAuthUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          clientId: clientInfo.clientId,
          clientSecret: clientInfo.clientSecret,
          startUrl,
        }),
      });

      if (!deviceRes.ok) {
        const error = await deviceRes.text();
        throw new Error(`Device authorization failed: ${error}`);
      }

      const deviceData = (await deviceRes.json()) as {
        deviceCode: string;
        userCode: string;
        verificationUri: string;
        verificationUriComplete: string;
        expiresIn: number;
        interval?: number;
      };

      return {
        device_code: deviceData.deviceCode,
        user_code: deviceData.userCode,
        verification_uri: deviceData.verificationUri,
        verification_uri_complete: deviceData.verificationUriComplete,
        expires_in: deviceData.expiresIn,
        interval: deviceData.interval || 5,
        _clientId: clientInfo.clientId,
        _clientSecret: clientInfo.clientSecret,
        _region: region,
        _authMethod: authMethod,
        _startUrl: startUrl,
      };
    },
    pollToken: async (config, deviceCode, codeVerifier, extraData) => {
      const region = (extraData as { _region?: string } | undefined)?._region || "us-east-1";
      const tokenUrl = `https://oidc.${region}.amazonaws.com/token`;
      const response = await fetch(tokenUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          clientId: (extraData as { _clientId?: string } | undefined)?._clientId,
          clientSecret: (extraData as { _clientSecret?: string } | undefined)?._clientSecret,
          deviceCode: deviceCode,
          grantType: "urn:ietf:params:oauth:grant-type:device_code",
        }),
      });

      let data: Record<string, unknown>;
      try {
        data = (await response.json()) as Record<string, unknown>;
      } catch {
        const text = await response.text();
        data = { error: "invalid_response", error_description: text };
      }

      if (typeof data.accessToken === "string") {
        const ed = (extraData as Record<string, unknown> | undefined) || {};
        return {
          ok: true,
          data: {
            access_token: data.accessToken,
            refresh_token: data.refreshToken,
            expires_in: data.expiresIn,
            profile_arn: (data as { profileArn?: string }).profileArn || null,
            _clientId: ed._clientId,
            _clientSecret: ed._clientSecret,
            _region: ed._region,
            _authMethod: ed._authMethod,
            _startUrl: ed._startUrl,
          },
        };
      }

      return {
        ok: false,
        data: {
          error: (data.error as string) || "authorization_pending",
          error_description: (data.error_description as string) || (data.message as string),
        },
      };
    },
    mapTokens: (tokens) => {
      const email = extractEmailFromAccessToken(tokens.access_token);
      return {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresIn: tokens.expires_in,
        email,
        providerSpecificData: {
          profileArn: tokens.profile_arn || null,
          clientId: tokens._clientId,
          clientSecret: tokens._clientSecret,
          region: tokens._region || "us-east-1",
          authMethod: tokens._authMethod || "builder-id",
          startUrl: tokens._startUrl || KIRO_CONFIG.startUrl,
        },
      };
    },
  },

  cursor: {
    config: CURSOR_CONFIG,
    flowType: "import_token",
    mapTokens: (tokens) => ({
      accessToken: tokens.accessToken,
      refreshToken: null,
      expiresIn: tokens.expiresIn || 86400,
      providerSpecificData: {
        machineId: tokens.machineId,
        authMethod: "imported",
      },
    }),
  },

  "kimi-coding": {
    config: KIMI_CODING_CONFIG,
    flowType: "device_code",
    requestDeviceCode: async (config) => {
      const response = await fetch(config.deviceCodeUrl!, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: new URLSearchParams({ client_id: config.clientId! }),
      });
      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Device code request failed: ${error}`);
      }
      const data = (await response.json()) as {
        device_code: string;
        user_code: string;
        verification_uri?: string;
        verification_uri_complete?: string;
        expires_in: number;
        interval?: number;
      };
      return {
        device_code: data.device_code,
        user_code: data.user_code,
        verification_uri: data.verification_uri || "https://www.kimi.com/code/authorize_device",
        verification_uri_complete:
          data.verification_uri_complete ||
          `https://www.kimi.com/code/authorize_device?user_code=${data.user_code}`,
        expires_in: data.expires_in,
        interval: data.interval || 5,
      };
    },
    pollToken: async (config, deviceCode) => {
      const response = await fetch(config.tokenUrl!, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: new URLSearchParams({
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          client_id: config.clientId!,
          device_code: deviceCode,
        }),
      });
      let data: Record<string, unknown>;
      try {
        data = (await response.json()) as Record<string, unknown>;
      } catch {
        const text = await response.text();
        data = { error: "invalid_response", error_description: text };
      }
      return { ok: response.ok, data };
    },
    mapTokens: (tokens) => ({
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresIn: tokens.expires_in,
    }),
  },

  kilocode: {
    config: KILOCODE_CONFIG,
    flowType: "device_code",
    requestDeviceCode: async (config) => {
      const response = await fetch(String(config.initiateUrl), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!response.ok) {
        if (response.status === 429) {
          throw new Error("Too many pending authorization requests. Please try again later.");
        }
        const error = await response.text();
        throw new Error(`Device auth initiation failed: ${error}`);
      }
      const data = (await response.json()) as {
        code: string;
        verificationUrl: string;
        expiresIn?: number;
      };
      return {
        device_code: data.code,
        user_code: data.code,
        verification_uri: data.verificationUrl,
        verification_uri_complete: data.verificationUrl,
        expires_in: data.expiresIn || 300,
        interval: 3,
      };
    },
    pollToken: async (config, deviceCode) => {
      const response = await fetch(`${config.pollUrlBase}/${deviceCode}`);
      if (response.status === 202) return { ok: false, data: { error: "authorization_pending" } };
      if (response.status === 403)
        return {
          ok: false,
          data: { error: "access_denied", error_description: "Authorization denied by user" },
        };
      if (response.status === 410)
        return {
          ok: false,
          data: { error: "expired_token", error_description: "Authorization code expired" },
        };
      if (!response.ok)
        return {
          ok: false,
          data: { error: "poll_failed", error_description: `Poll failed: ${response.status}` },
        };
      const data = (await response.json()) as {
        status?: string;
        token?: string;
        userEmail?: string;
      };
      if (data.status === "approved" && data.token) {
        let orgId: string | null = null;
        try {
          const profileRes = await fetch(`${config.apiBaseUrl}/api/profile`, {
            headers: { Authorization: `Bearer ${data.token}` },
          });
          if (profileRes.ok) {
            const profile = (await profileRes.json()) as { organizations?: Array<{ id?: string }> };
            orgId = profile.organizations?.[0]?.id || null;
          }
        } catch {}
        return {
          ok: true,
          data: { access_token: data.token, _userEmail: data.userEmail, _orgId: orgId },
        };
      }
      return { ok: false, data: { error: "authorization_pending" } };
    },
    mapTokens: (tokens) => ({
      accessToken: tokens.access_token,
      refreshToken: null,
      expiresIn: null,
      email: tokens._userEmail,
      ...(tokens._orgId ? { providerSpecificData: { orgId: tokens._orgId } } : {}),
    }),
  },

  cline: {
    config: CLINE_CONFIG,
    flowType: "authorization_code",
    buildAuthUrl: (config, redirectUri) => {
      const params = new URLSearchParams({
        client_type: "extension",
        callback_url: redirectUri,
        redirect_uri: redirectUri,
      });
      return `${config.authorizeUrl!}?${params.toString()}`;
    },
    exchangeToken: async (config, code, redirectUri) => {
      try {
        let base64 = code;
        const padding = 4 - (base64.length % 4);
        if (padding !== 4) base64 += "=".repeat(padding);
        const decoded = Buffer.from(base64, "base64").toString("utf-8");
        const lastBrace = decoded.lastIndexOf("}");
        if (lastBrace === -1) throw new Error("No JSON found in decoded code");
        const tokenData = JSON.parse(decoded.substring(0, lastBrace + 1)) as Record<
          string,
          unknown
        >;
        return {
          access_token:
            typeof tokenData.accessToken === "string" ? tokenData.accessToken : undefined,
          refresh_token:
            typeof tokenData.refreshToken === "string" ? tokenData.refreshToken : undefined,
          email: typeof tokenData.email === "string" ? tokenData.email : undefined,
          firstName: typeof tokenData.firstName === "string" ? tokenData.firstName : undefined,
          lastName: typeof tokenData.lastName === "string" ? tokenData.lastName : undefined,
          expires_at: typeof tokenData.expiresAt === "string" ? tokenData.expiresAt : undefined,
        };
      } catch {
        const response = await fetch(config.tokenExchangeUrl as string, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({
            grant_type: "authorization_code",
            code,
            client_type: "extension",
            redirect_uri: redirectUri,
          }),
        });
        if (!response.ok) {
          const error = await response.text();
          throw new Error(`Cline token exchange failed: ${error}`);
        }
        const data = (await response.json()) as {
          data?: {
            accessToken?: string;
            refreshToken?: string;
            userInfo?: { email?: string };
            expiresAt?: string;
          };
          accessToken?: string;
          refreshToken?: string;
          expiresAt?: string;
        };
        return {
          access_token: data.data?.accessToken || data.accessToken,
          refresh_token: data.data?.refreshToken || data.refreshToken,
          email: data.data?.userInfo?.email || "",
          expires_at: data.data?.expiresAt || data.expiresAt,
        };
      }
    },
    mapTokens: (tokens) => ({
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresIn: tokens.expires_at
        ? Math.floor((new Date(tokens.expires_at).getTime() - Date.now()) / 1000)
        : 3600,
      email: tokens.email,
      providerSpecificData: { firstName: tokens.firstName, lastName: tokens.lastName },
    }),
  },

  gitlab: {
    config: GITLAB_CONFIG,
    flowType: "authorization_code_pkce",
    buildAuthUrl: (config, redirectUri, state, codeChallenge, meta = {}) => {
      const baseUrl = (meta.baseUrl as string | undefined) || config.defaultBaseUrl;
      const clientId = (meta.clientId as string | undefined) || "";
      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        state,
        scope: config.scope!,
        code_challenge: codeChallenge ?? "",
        code_challenge_method: config.codeChallengeMethod!,
      });
      return `${baseUrl}${config.authorizeUrlPath}?${params.toString()}`;
    },
    exchangeToken: async (config, code, redirectUri, codeVerifier, _state, meta = {}) => {
      const baseUrl = (meta.baseUrl as string | undefined) || config.defaultBaseUrl;
      const clientId = (meta.clientId as string | undefined) || "";
      const clientSecret = (meta.clientSecret as string | undefined) || "";
      const body = new URLSearchParams({
        client_id: clientId,
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      });
      if (clientSecret) body.set("client_secret", clientSecret);
      const response = await fetch(`${baseUrl}${config.tokenUrlPath}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: body.toString(),
      });
      if (!response.ok) throw new Error(`GitLab token exchange failed: ${await response.text()}`);
      const tokens = (await response.json()) as TokenResponse & Record<string, unknown>;
      const userRes = await fetch(`${baseUrl}${config.userInfoUrlPath}`, {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      const user = userRes.ok ? ((await userRes.json()) as Record<string, unknown>) : {};
      return { ...tokens, _user: user, _baseUrl: baseUrl, _clientId: clientId };
    },
    mapTokens: (tokens) => {
      const user = tokens._user as
        | { username?: string; email?: string; public_email?: string; name?: string }
        | undefined;
      return {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresIn: tokens.expires_in,
        scope: tokens.scope,
        providerSpecificData: {
          username: user?.username || "",
          email: user?.email || user?.public_email || "",
          name: user?.name || "",
          baseUrl: tokens._baseUrl,
          clientId: tokens._clientId,
          authKind: "oauth",
        },
      };
    },
  },

  codebuddy: {
    config: CODEBUDDY_CONFIG,
    flowType: "device_code",
    requestDeviceCode: async (config) => {
      const response = await fetch(
        String(config.stateUrl) + "?platform=" + String(config.platform),
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            "User-Agent": config.userAgent!,
            "X-Requested-With": "XMLHttpRequest",
            "X-Domain": "copilot.tencent.com",
            "X-No-Authorization": "true",
            "X-No-User-Id": "true",
            "X-Product": "SaaS",
          },
          body: "{}",
        },
      );
      if (!response.ok) throw new Error(`CodeBuddy state request failed: ${await response.text()}`);
      const data = (await response.json()) as {
        code: number;
        msg?: string;
        data?: { state?: string; authUrl?: string };
      };
      if (data.code !== 0 || !data.data?.state || !data.data?.authUrl) {
        throw new Error(`CodeBuddy state error: ${data.msg || "missing state/authUrl"}`);
      }
      return {
        device_code: data.data.state,
        verification_uri: data.data.authUrl,
        user_code: "",
        interval: (config.pollInterval ?? 5000) / 1000,
        _isCodeBuddy: true,
      };
    },
    pollToken: async (config, deviceCode) => {
      const response = await fetch(String(config.tokenUrl), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "User-Agent": config.userAgent ?? "",
          "X-Requested-With": "XMLHttpRequest",
          "X-Domain": "copilot.tencent.com",
          "X-No-Authorization": "true",
          "X-No-User-Id": "true",
          "X-Product": "SaaS",
        },
        body: JSON.stringify({ state: deviceCode }),
      });
      if (!response.ok) return { ok: false, data: { error: "request_failed" } };
      const data = (await response.json()) as {
        code: number;
        msg?: string;
        data?: { accessToken?: string; refreshToken?: string; tokenType?: string };
      };
      if (data.code === 0 && data.data?.accessToken) {
        return {
          ok: true,
          data: {
            access_token: data.data.accessToken,
            refresh_token: data.data.refreshToken || "",
            token_type: data.data.tokenType || "Bearer",
          },
        };
      }
      if (data.code === 11217) return { ok: true, data: { error: "authorization_pending" } };
      return { ok: false, data: { error: data.msg || "unknown_error" } };
    },
    mapTokens: (tokens) => ({
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresIn: 86400,
      providerSpecificData: {},
    }),
  },
};

export function getProvider(name: string): ProviderHandler {
  const provider = PROVIDERS[name];
  if (!provider) {
    throw new Error(`Unknown provider: ${name}`);
  }
  return provider;
}

export function getProviderNames(): string[] {
  return Object.keys(PROVIDERS);
}

export function generateAuthData(
  providerName: string,
  redirectUri: string,
  meta?: AuthMeta,
): {
  authUrl: string | null;
  state: string;
  codeVerifier: string;
  codeChallenge: string;
  redirectUri: string;
  flowType: ProviderHandler["flowType"];
  fixedPort: number | undefined;
  callbackPath: string;
} {
  const provider = getProvider(providerName);
  const { codeVerifier, codeChallenge, state } = generatePKCE();

  let authUrl: string | null;
  if (provider.flowType === "device_code") {
    authUrl = null;
  } else if (provider.flowType === "authorization_code_pkce") {
    authUrl =
      provider.buildAuthUrl?.(provider.config, redirectUri, state, codeChallenge, meta || {}) ||
      null;
  } else {
    authUrl =
      provider.buildAuthUrl?.(provider.config, redirectUri, state, undefined, meta || {}) || null;
  }

  return {
    authUrl,
    state,
    codeVerifier,
    codeChallenge,
    redirectUri,
    flowType: provider.flowType,
    fixedPort: provider.fixedPort,
    callbackPath: provider.callbackPath || "/callback",
  };
}

export async function exchangeTokens(
  providerName: string,
  code: string,
  redirectUri: string,
  codeVerifier: string,
  state?: string,
  meta?: AuthMeta,
): Promise<Record<string, unknown>> {
  const provider = getProvider(providerName);

  const tokens = await provider.exchangeToken?.(
    provider.config,
    code,
    redirectUri,
    codeVerifier,
    state,
    meta || {},
  );

  if (!tokens) {
    throw new Error(`Provider ${providerName} does not support exchangeToken`);
  }

  let extra: ExtraResult | null = null;
  if (provider.postExchange) {
    extra = await provider.postExchange(tokens);
  }

  return provider.mapTokens(tokens, extra);
}

export async function requestDeviceCode(
  providerName: string,
  codeChallenge: string | undefined,
  options?: AuthMeta,
): Promise<DeviceCodeResponse> {
  const provider = getProvider(providerName);
  if (provider.flowType !== "device_code") {
    throw new Error(`Provider ${providerName} does not support device code flow`);
  }
  if (!provider.requestDeviceCode) {
    throw new Error(`Provider ${providerName} has no requestDeviceCode handler`);
  }
  return await provider.requestDeviceCode(provider.config, codeChallenge, options || {});
}

export type PollForTokenResult =
  | { success: true; tokens: Record<string, unknown> }
  | { success: false; error: string; errorDescription?: string; pending?: boolean };

export async function pollForToken(
  providerName: string,
  deviceCode: string,
  codeVerifier: string | undefined,
  extraData?: AuthMeta,
): Promise<PollForTokenResult> {
  const provider = getProvider(providerName);
  if (provider.flowType !== "device_code") {
    throw new Error(`Provider ${providerName} does not support device code flow`);
  }
  if (!provider.pollToken) {
    throw new Error(`Provider ${providerName} has no pollToken handler`);
  }

  const result = await provider.pollToken(provider.config, deviceCode, codeVerifier, extraData);

  if (result.ok) {
    if (result.data.access_token) {
      let extra: ExtraResult | null = null;
      if (provider.postExchange) {
        extra = await provider.postExchange(result.data as unknown as TokenResponse);
      }
      return {
        success: true,
        tokens: provider.mapTokens(result.data as unknown as TokenResponse, extra),
      };
    }
    if (result.data.error === "authorization_pending" || result.data.error === "slow_down") {
      return {
        success: false,
        error: (result.data.error as string) || "authorization_pending",
        errorDescription:
          (result.data.error_description as string) || (result.data.message as string),
        pending: result.data.error === "authorization_pending",
      };
    }
    return {
      success: false,
      error: (result.data.error as string) || "no_access_token",
      errorDescription:
        (result.data.error_description as string) ||
        (result.data.message as string) ||
        "No access token received",
    };
  }

  return {
    success: false,
    error: (result.data.error as string) || "unknown",
    errorDescription: (result.data.error_description as string) || undefined,
  };
}

let codexBackfillDone = false;

export async function backfillCodexEmails(): Promise<void> {
  if (codexBackfillDone) return;
  codexBackfillDone = true;
  try {
    const { getProviderConnections, updateProviderConnection } = await import("@/lib/localDb");
    const connections = (await getProviderConnections()) as Array<{
      id: string;
      provider: string;
      authType: string;
      idToken?: string;
      email?: string;
      providerSpecificData?: { chatgptAccountId?: string; [k: string]: unknown };
    }>;
    const targets = connections.filter((c) => {
      if (c.provider !== "codex" || c.authType !== "oauth" || !c.idToken) return false;
      const hasEmail = !!c.email;
      const hasAccountInfo = !!c.providerSpecificData?.chatgptAccountId;
      return !hasEmail || !hasAccountInfo;
    });
    for (const conn of targets) {
      const info = extractCodexAccountInfo(conn.idToken);
      if (!info.email && !info.chatgptAccountId) continue;
      const patch: Record<string, unknown> = {};
      if (!conn.email && info.email) patch.email = info.email;
      if (info.chatgptAccountId || info.chatgptPlanType) {
        patch.providerSpecificData = {
          ...(conn.providerSpecificData || {}),
          chatgptAccountId: info.chatgptAccountId,
          chatgptPlanType: info.chatgptPlanType,
        };
      }
      if (Object.keys(patch).length) {
        await updateProviderConnection(conn.id, patch);
      }
    }
  } catch (err) {
    codexBackfillDone = false;
    console.log("backfillCodexEmails failed:", (err as Error)?.message || err);
  }
}
