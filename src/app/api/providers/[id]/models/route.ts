import { NextResponse } from "next/server";
import { resolveOllamaLocalHost } from "open-sse/config/providers.ts";
import { asApiRecord, asString } from "@/app/api/_types";
import { GEMINI_CONFIG } from "@/lib/oauth/constants/oauth";
import { KiroService } from "@/lib/oauth/services/kiro";
import { sanitizeError } from "@/lib/sanitizeError";
import { getProviderConnectionById } from "@/models";
import {
  isAnthropicCompatibleProvider,
  isOpenAICompatibleProvider,
} from "@/shared/constants/providers";
import {
  refreshGoogleToken,
  refreshKiroToken,
  updateProviderCredentials,
} from "@/sse/services/tokenRefresh";

const GEMINI_CLI_MODELS_URL = "https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels";

type ModelRow = Record<string, unknown> & { id?: unknown; name?: unknown };

const parseOpenAIStyleModels = (data: unknown): ModelRow[] => {
  if (Array.isArray(data)) return data as ModelRow[];
  const rec = asApiRecord(data);
  const list = rec.data ?? rec.models ?? rec.results;
  return Array.isArray(list) ? (list as ModelRow[]) : [];
};

const parseGeminiCliModels = (data: unknown): ModelRow[] => {
  const rec = asApiRecord(data);
  if (Array.isArray(rec.models)) {
    return rec.models
      .map((item: unknown) => {
        const row = asApiRecord(item);
        const id = row.id || row.model || row.name;
        if (!id) return null;
        return { id, name: row.displayName || row.name || id } as ModelRow;
      })
      .filter(Boolean) as ModelRow[];
  }

  if (rec.models && typeof rec.models === "object") {
    return Object.entries(rec.models as Record<string, unknown>)
      .filter(([, info]) => !(info as Record<string, unknown>)?.isInternal)
      .map(([id, info]) => {
        const modelInfo = info as Record<string, unknown>;
        return {
          id,
          name: (modelInfo?.displayName as string) || (modelInfo?.name as string) || id,
        };
      });
  }

  return [];
};

const appendCodexReviewModels = (models: ModelRow[]) =>
  models.flatMap((model) => {
    const id = String(model?.id || model?.slug || model?.model || model?.name || "");
    if (!id) return [];
    const name = String(model?.display_name || model?.displayName || model?.name || id);
    const normalized = { ...model, id, name };
    const isChatModel = (model?.type || "llm") !== "image" && !id.toLowerCase().includes("embed");
    if (!isChatModel || id.endsWith("-review")) return [normalized];
    return [
      normalized,
      {
        ...normalized,
        id: `${id}-review`,
        name: `${name} Review`,
        upstreamModelId: id,
        quotaFamily: "review",
      },
    ];
  });

const parseCodexModels = (data: unknown) => appendCodexReviewModels(parseOpenAIStyleModels(data));

const createOpenAIModelsConfig = (url: string) => ({
  url,
  method: "GET",
  headers: { "Content-Type": "application/json" },
  authHeader: "Authorization",
  authPrefix: "Bearer ",
  parseResponse: parseOpenAIStyleModels,
});

const resolveQwenModelsUrl = (
  connection: { providerSpecificData?: unknown } | Record<string, unknown>,
) => {
  const fallback = "https://portal.qwen.ai/v1/models";
  const raw = asApiRecord(connection?.providerSpecificData).resourceUrl;
  if (!raw || typeof raw !== "string") return fallback;
  const value = raw.trim();
  if (!value) return fallback;
  if (value.startsWith("http://") || value.startsWith("https://")) {
    return `${value.replace(/\/$/, "")}/models`;
  }
  return `https://${value.replace(/\/$/, "")}/v1/models`;
};

// Provider models endpoints configuration
const PROVIDER_MODELS_CONFIG = {
  claude: {
    url: "https://api.anthropic.com/v1/models",
    method: "GET",
    headers: {
      "Anthropic-Version": "2023-06-01",
      "Content-Type": "application/json",
    },
    authHeader: "x-api-key",
    parseResponse: (data: unknown) => asApiRecord(data).data || [],
  },
  gemini: {
    url: "https://generativelanguage.googleapis.com/v1beta/models",
    method: "GET",
    headers: { "Content-Type": "application/json" },
    authQuery: "key", // Use query param for API key
    parseResponse: (data: unknown) => asApiRecord(data).models || [],
  },
  qwen: {
    url: "https://portal.qwen.ai/v1/models",
    method: "GET",
    headers: { "Content-Type": "application/json" },
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    parseResponse: (data: unknown) => asApiRecord(data).data || [],
  },
  codex: {
    url: "https://chatgpt.com/backend-api/codex/models?client_version=1.0.0",
    method: "GET",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    parseResponse: parseCodexModels,
  },
  antigravity: {
    url: "https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:models",
    method: "POST",
    headers: { "Content-Type": "application/json" },
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    body: {},
    parseResponse: (data: unknown) => asApiRecord(data).models || [],
  },
  github: {
    url: "https://api.githubcopilot.com/models",
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      "Copilot-Integration-Id": "vscode-chat",
      "editor-version": "vscode/1.107.1",
      "editor-plugin-version": "copilot-chat/0.26.7",
      "user-agent": "GitHubCopilotChat/0.26.7",
    },
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    parseResponse: (data: unknown) => {
      const rec = asApiRecord(data);
      if (!Array.isArray(rec.data)) return [];
      // Filter out embeddings, non-chat models, and disabled models
      return (rec.data as ModelRow[])
        .filter((m) => asApiRecord(m.capabilities).type === "chat")
        .filter((m) => asApiRecord(m.policy).state !== "disabled") // Only return explicitly enabled models
        .map((m) => ({
          id: m.id,
          name: m.name || m.id,
          version: m.version,
          capabilities: m.capabilities,
          isDefault: m.model_picker_enabled === true,
        }));
    },
  },
  openai: createOpenAIModelsConfig("https://api.openai.com/v1/models"),
  openrouter: createOpenAIModelsConfig("https://openrouter.ai/api/v1/models"),
  anthropic: {
    url: "https://api.anthropic.com/v1/models",
    method: "GET",
    headers: {
      "Anthropic-Version": "2023-06-01",
      "Content-Type": "application/json",
    },
    authHeader: "x-api-key",
    parseResponse: (data: unknown) => asApiRecord(data).data || [],
  },

  alicode: {
    url: "https://coding.dashscope.aliyuncs.com/v1/models",
    method: "GET",
    headers: { "Content-Type": "application/json" },
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    parseResponse: (data: unknown) => asApiRecord(data).data || [],
  },
  "alicode-intl": {
    url: "https://coding-intl.dashscope.aliyuncs.com/v1/models",
    method: "GET",
    headers: { "Content-Type": "application/json" },
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    parseResponse: (data: unknown) => asApiRecord(data).data || [],
  },
  "volcengine-ark": createOpenAIModelsConfig(
    "https://ark.cn-beijing.volces.com/api/coding/v3/models",
  ),
  byteplus: createOpenAIModelsConfig(
    "https://ark.ap-southeast.bytepluses.com/api/coding/v3/models",
  ),

  // OpenAI-compatible API key providers
  deepseek: createOpenAIModelsConfig("https://api.deepseek.com/models"),
  groq: createOpenAIModelsConfig("https://api.groq.com/openai/v1/models"),
  xai: createOpenAIModelsConfig("https://api.x.ai/v1/models"),
  mistral: createOpenAIModelsConfig("https://api.mistral.ai/v1/models"),
  together: createOpenAIModelsConfig("https://api.together.xyz/v1/models"),
  fireworks: createOpenAIModelsConfig("https://api.fireworks.ai/inference/v1/models"),
  cerebras: createOpenAIModelsConfig("https://api.cerebras.ai/v1/models"),
  cohere: createOpenAIModelsConfig("https://api.cohere.ai/v1/models"),
  nebius: createOpenAIModelsConfig("https://api.studio.nebius.ai/v1/models"),
  siliconflow: createOpenAIModelsConfig("https://api.siliconflow.cn/v1/models"),
  hyperbolic: createOpenAIModelsConfig("https://api.hyperbolic.xyz/v1/models"),
  ollama: createOpenAIModelsConfig("https://ollama.com/api/tags"),
  // ollama-local: url resolved dynamically below via providerSpecificData.baseUrl
  nanobanana: createOpenAIModelsConfig("https://api.nanobananaapi.ai/v1/models"),
  chutes: createOpenAIModelsConfig("https://llm.chutes.ai/v1/models"),
  nvidia: createOpenAIModelsConfig("https://integrate.api.nvidia.com/v1/models"),
  assemblyai: createOpenAIModelsConfig("https://api.assemblyai.com/v1/models"),
};

/**
 * GET /api/providers/[id]/models - Get models list from provider
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const connection = await getProviderConnectionById(id);

    if (!connection) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }

    if (isOpenAICompatibleProvider(connection.provider)) {
      const psd = (connection.providerSpecificData ?? {}) as Record<string, unknown>;
      const baseUrl = asString(psd.baseUrl);
      if (!baseUrl) {
        return NextResponse.json(
          { error: "No base URL configured for OpenAI compatible provider" },
          { status: 400 },
        );
      }
      const url = `${baseUrl.replace(/\/$/, "")}/models`;
      const response = await fetch(url, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${connection.apiKey}`,
        },
      });

      if (!response.ok) {
        await response.text().catch(() => "");
        return NextResponse.json(
          { error: `Failed to fetch models: ${response.status}` },
          { status: response.status },
        );
      }

      const data = await response.json();
      const models = data.data || data.models || [];

      return NextResponse.json({
        provider: connection.provider,
        connectionId: connection.id,
        models,
      });
    }

    if (isAnthropicCompatibleProvider(connection.provider)) {
      const psd = (connection.providerSpecificData ?? {}) as Record<string, unknown>;
      let baseUrl = asString(psd.baseUrl);
      if (!baseUrl) {
        return NextResponse.json(
          { error: "No base URL configured for Anthropic compatible provider" },
          { status: 400 },
        );
      }

      baseUrl = baseUrl.replace(/\/$/, "");
      if (baseUrl.endsWith("/messages")) {
        baseUrl = baseUrl.slice(0, -9);
      }

      const url = `${baseUrl}/models`;
      const response = await fetch(url, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": asString(connection.apiKey),
          "anthropic-version": "2023-06-01",
          Authorization: `Bearer ${asString(connection.apiKey)}`,
        },
      });

      if (!response.ok) {
        await response.text().catch(() => "");
        return NextResponse.json(
          { error: `Failed to fetch models: ${response.status}` },
          { status: response.status },
        );
      }

      const data = await response.json();
      const models = data.data || data.models || [];

      return NextResponse.json({
        provider: connection.provider,
        connectionId: connection.id,
        models,
      });
    }

    // Kiro: Try dynamic model fetching first
    if (connection.provider === "kiro") {
      const psd = (connection.providerSpecificData ?? {}) as Record<string, unknown>;
      let warning;
      try {
        const kiroService = new KiroService();
        const profileArn = psd.profileArn;
        const accessToken = connection.accessToken;
        const refreshToken = connection.refreshToken;

        if (accessToken && profileArn) {
          try {
            const models = await kiroService.listAvailableModels(
              asString(accessToken),
              asString(profileArn),
            );
            return NextResponse.json({
              provider: connection.provider,
              connectionId: connection.id,
              models,
            });
          } catch (error) {
            if (sanitizeError(error).includes("AccessDeniedException") && refreshToken) {
              const refreshed = await refreshKiroToken(
                asString(refreshToken),
                connection.providerSpecificData as Record<string, unknown>,
              );

              if (refreshed?.accessToken) {
                await updateProviderCredentials(connection.id, {
                  accessToken: refreshed.accessToken,
                  refreshToken: refreshed.refreshToken || refreshToken,
                  expiresIn: refreshed.expiresIn,
                });

                const models = await kiroService.listAvailableModels(
                  asString(refreshed.accessToken),
                  asString(profileArn),
                );
                return NextResponse.json({
                  provider: connection.provider,
                  connectionId: connection.id,
                  models,
                });
              }
            }
            throw error; // Let outer catch handle it
          }
        }
      } catch (error) {
        warning = `Failed to fetch Kiro models: ${sanitizeError(error)}`;
      }

      // Return empty dynamic list so UI falls back to static provider models.
      return NextResponse.json({
        provider: connection.provider,
        connectionId: connection.id,
        models: [],
        warning,
      });
    }

    if (connection.provider === "gemini-cli") {
      const { accessToken, refreshToken } = connection ?? {};
      if (!accessToken) {
        return NextResponse.json({ error: "No valid token found" }, { status: 401 });
      }

      const psd = (connection.providerSpecificData ?? {}) as Record<string, unknown>;
      const projectId = connection.projectId || psd.projectId;
      const body = projectId ? { project: projectId } : {};

      const fetchModels = async (token: string) => {
        const response = await fetch(GEMINI_CLI_MODELS_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            "User-Agent": "google-api-nodejs-client/9.15.1",
            "X-Goog-Api-Client": "google-cloud-sdk vscode_cloudshelleditor/0.1",
          },
          body: JSON.stringify(body),
        });
        return response;
      };

      let warning;

      try {
        let response = await fetchModels(asString(accessToken));

        // Attempt refresh on 401/403 when refresh token exists
        if (!response.ok && (response.status === 401 || response.status === 403) && refreshToken) {
          const refreshed = await refreshGoogleToken(
            asString(refreshToken),
            GEMINI_CONFIG.clientId,
            GEMINI_CONFIG.clientSecret,
          );
          if (refreshed?.accessToken) {
            await updateProviderCredentials(connection.id, {
              accessToken: refreshed.accessToken,
              refreshToken: refreshed.refreshToken,
              expiresIn: refreshed.expiresIn,
            });
            response = await fetchModels(refreshed.accessToken);
          }
        }

        if (response.ok) {
          const data = await response.json();
          const models = parseGeminiCliModels(data);
          if (models.length > 0) {
            return NextResponse.json({
              provider: connection.provider,
              connectionId: connection.id,
              models,
            });
          }
        } else {
          warning = `Failed to fetch Gemini CLI models (HTTP ${response.status})`;
        }
      } catch (error) {
        warning = `Failed to fetch Gemini CLI models: ${sanitizeError(error)}`;
      }

      // Return empty dynamic list so UI falls back to static provider models.
      return NextResponse.json({
        provider: connection.provider,
        connectionId: connection.id,
        models: [],
        warning,
      });
    }

    if (connection.provider === "ollama-local") {
      const url = `${resolveOllamaLocalHost({
        providerSpecificData: connection.providerSpecificData as { baseUrl?: string } | undefined,
      })}/api/tags`;
      const response = await fetch(url, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      });
      if (!response.ok) {
        await response.text().catch(() => "");
        return NextResponse.json(
          { error: `Failed to fetch models: ${response.status}` },
          { status: response.status },
        );
      }
      const data = await response.json();
      const models = parseOpenAIStyleModels(data);
      return NextResponse.json({
        provider: connection.provider,
        connectionId: connection.id,
        models,
      });
    }

    const config = PROVIDER_MODELS_CONFIG[
      connection.provider as keyof typeof PROVIDER_MODELS_CONFIG
    ] as
      | {
          url?: string;
          method?: string;
          headers?: Record<string, string>;
          authHeader?: string;
          authPrefix?: string;
          authQuery?: string;
          body?: unknown;
          parseResponse?: (data: unknown) => unknown[];
        }
      | undefined;
    if (!config) {
      return NextResponse.json(
        { error: `Provider ${connection.provider} does not support models listing` },
        { status: 400 },
      );
    }

    // Get auth token
    const psd = (connection.providerSpecificData ?? {}) as Record<string, unknown>;
    const token = psd.copilotToken || connection.accessToken || connection.apiKey;
    if (!token) {
      return NextResponse.json({ error: "No valid token found" }, { status: 401 });
    }

    // config is guaranteed non-null after the check above
    const cfg = config as NonNullable<typeof config>;

    // Build request URL
    let url = cfg.url ?? "";
    if (connection.provider === "qwen") {
      url = resolveQwenModelsUrl(connection as { providerSpecificData?: unknown });
    }
    if (cfg.authQuery) {
      url += `?${cfg.authQuery}=${token}`;
    }

    // Build headers
    const headers: Record<string, string> = { ...cfg.headers };
    if (cfg.authHeader && !cfg.authQuery) {
      headers[cfg.authHeader] = (cfg.authPrefix || "") + token;
    }

    // Make request
    const fetchOptions: Record<string, unknown> & {
      method?: string;
      headers?: Record<string, string>;
    } = {
      method: cfg.method,
      headers,
    };

    if (cfg.body && cfg.method === "POST") {
      fetchOptions.body = JSON.stringify(cfg.body);
    }

    const response = await fetch(url, fetchOptions);

    if (!response.ok) {
      await response.text().catch(() => "");
      return NextResponse.json(
        { error: `Failed to fetch models: ${response.status}` },
        { status: response.status },
      );
    }

    const data = await response.json();
    const models = cfg.parseResponse ? cfg.parseResponse(data) : [];

    return NextResponse.json({
      provider: connection.provider,
      connectionId: connection.id,
      models,
    });
  } catch (_error) {
    console.log("Error fetching provider models");
    return NextResponse.json({ error: "Failed to fetch models" }, { status: 500 });
  }
}
