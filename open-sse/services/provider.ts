// @ts-nocheck
import { buildClineHeaders } from "../../src/shared/utils/clineAuth.mts";
import { PROVIDERS } from "../config/providers.js";

type JsonRecord = Record<string, unknown>;
type ProviderCredentials = {
  accessToken?: string;
  apiKey?: string;
  copilotToken?: string;
  providerSpecificData?: JsonRecord;
};
type ProviderOptions = {
  baseUrl?: string;
  baseUrlIndex?: number;
  qwenResourceUrl?: string;
};
type ProviderConfig = {
  baseUrl?: string;
  baseUrls?: string[];
  format?: string;
  headers?: Record<string, string>;
  [key: string]: unknown;
};
type MessageContentPart = {
  image_url?: { url?: unknown };
  source?: { type?: unknown };
  type?: string;
};
type Message = {
  content?: unknown;
  role?: string;
};
type RequestBody = JsonRecord & {
  anthropic_version?: unknown;
  contents?: unknown;
  frequency_penalty?: unknown;
  input?: unknown;
  logit_bias?: unknown;
  logprobs?: unknown;
  messages?: Message[];
  model?: unknown;
  n?: unknown;
  presence_penalty?: unknown;
  reasoning_effort?: unknown;
  request?: { contents?: unknown };
  response_format?: unknown;
  stream_options?: unknown;
  system?: unknown;
  thinking?: { type?: unknown };
  top_logprobs?: unknown;
  user?: unknown;
  userAgent?: unknown;
};

const OPENAI_COMPATIBLE_PREFIX = "openai-compatible-";
const OPENAI_COMPATIBLE_DEFAULTS = {
  baseUrl: "https://api.openai.com/v1",
};

const ANTHROPIC_COMPATIBLE_PREFIX = "anthropic-compatible-";
const ANTHROPIC_COMPATIBLE_DEFAULTS = {
  baseUrl: "https://api.anthropic.com/v1",
};

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function isOpenAICompatible(provider: unknown): provider is string {
  return typeof provider === "string" && provider.startsWith(OPENAI_COMPATIBLE_PREFIX);
}

function isAnthropicCompatible(provider: unknown): provider is string {
  return typeof provider === "string" && provider.startsWith(ANTHROPIC_COMPATIBLE_PREFIX);
}

function getOpenAICompatibleType(provider: string) {
  if (!isOpenAICompatible(provider)) return "chat";
  return provider.includes("responses") ? "responses" : "chat";
}

function buildOpenAICompatibleUrl(baseUrl: string, apiType: string) {
  const normalized = baseUrl.replace(/\/$/, "");
  const path = apiType === "responses" ? "/responses" : "/chat/completions";
  return `${normalized}${path}`;
}

function buildAnthropicCompatibleUrl(baseUrl: string) {
  const normalized = baseUrl.replace(/\/$/, "");
  return `${normalized}/messages`;
}

function buildQwenBaseUrl(resourceUrl: unknown, fallbackBaseUrl: string | undefined) {
  const fallback = (fallbackBaseUrl || "").replace(/\/chat\/completions$/, "");
  const raw = typeof resourceUrl === "string" ? resourceUrl.trim() : "";
  if (!raw) return fallback;
  if (raw.startsWith("http://") || raw.startsWith("https://")) {
    return raw.replace(/\/$/, "");
  }
  return `https://${raw.replace(/\/$/, "")}/v1`;
}

// Detect request format from body structure
export function detectFormat(body: RequestBody) {
  // OpenAI Responses API: has input (array or string) instead of messages[]
  // The Responses API accepts both input as array and input as a plain string
  if (
    body.input &&
    (Array.isArray(body.input) || typeof body.input === "string") &&
    !body.messages
  ) {
    return "openai-responses";
  }

  // Antigravity format: Gemini wrapped in body.request
  if (body.request?.contents && body.userAgent === "antigravity") {
    return "antigravity";
  }

  // Gemini format: has contents array
  if (body.contents && Array.isArray(body.contents)) {
    return "gemini";
  }

  // OpenAI-specific indicators (check BEFORE Claude)
  // These fields are OpenAI-specific and never appear in Claude format
  if (
    body.stream_options || // OpenAI streaming options
    body.response_format || // JSON mode, etc.
    body.logprobs !== undefined || // Log probabilities
    body.top_logprobs !== undefined ||
    body.n !== undefined || // Number of completions
    body.presence_penalty !== undefined || // Penalties
    body.frequency_penalty !== undefined ||
    body.logit_bias || // Token biasing
    body.user // User identifier
  ) {
    return "openai";
  }

  // Claude format: messages with content as array of objects with type
  // Claude requires content to be array with specific structure
  if (body.messages && Array.isArray(body.messages)) {
    const firstMsg = body.messages[0];

    // If content is array, check if it follows Claude structure
    if (firstMsg?.content && Array.isArray(firstMsg.content)) {
      const firstContent = firstMsg.content[0] as MessageContentPart | undefined;

      // Claude format has specific types: text, image, tool_use, tool_result
      // OpenAI multimodal has: text, image_url (note the difference)
      if (
        firstContent?.type === "text" &&
        !(typeof body.model === "string" && body.model.includes("/"))
      ) {
        // Could be Claude or OpenAI multimodal
        // Check for Claude-specific fields
        if (body.system || body.anthropic_version) {
          return "claude";
        }
        // Check if image format is Claude (source.type) vs OpenAI (image_url.url)
        const hasClaudeImage = firstMsg.content.some(
          (c: MessageContentPart) => c.type === "image" && c.source?.type === "base64",
        );
        const hasOpenAIImage = firstMsg.content.some(
          (c: MessageContentPart) => c.type === "image_url" && c.image_url?.url,
        );
        if (hasClaudeImage) return "claude";
        if (hasOpenAIImage) return "openai";

        // If still unclear, check for tool format
        const hasClaudeTool = firstMsg.content.some(
          (c: MessageContentPart) => c.type === "tool_use" || c.type === "tool_result",
        );
        if (hasClaudeTool) return "claude";
      }
    }

    // If content is string, it's likely OpenAI (Claude also supports this)
    // Check for other Claude-specific indicators
    if (body.system !== undefined || body.anthropic_version) {
      return "claude";
    }
  }

  // Default to OpenAI format
  return "openai";
}

// Get provider config
export function getProviderConfig(provider: string): ProviderConfig {
  if (isOpenAICompatible(provider)) {
    const apiType = getOpenAICompatibleType(provider);
    return {
      ...PROVIDERS.openai,
      format: apiType === "responses" ? "openai-responses" : "openai",
      baseUrl: OPENAI_COMPATIBLE_DEFAULTS.baseUrl,
    };
  }
  if (isAnthropicCompatible(provider)) {
    return {
      ...PROVIDERS.anthropic, // Use Anthropic defaults (header: x-api-key)
      format: "claude",
      baseUrl: ANTHROPIC_COMPATIBLE_DEFAULTS.baseUrl,
    };
  }
  return (PROVIDERS as Record<string, ProviderConfig>)[provider] || PROVIDERS.openai;
}

// Get number of fallback URLs for provider (for retry logic)
export function getProviderFallbackCount(provider: string) {
  const config = getProviderConfig(provider);
  return config.baseUrls?.length || 1;
}

// Build provider URL
export function buildProviderUrl(
  provider: string,
  model: string,
  stream: boolean = true,
  options: ProviderOptions = {},
) {
  if (isOpenAICompatible(provider)) {
    const apiType = getOpenAICompatibleType(provider);
    const baseUrl = options?.baseUrl || OPENAI_COMPATIBLE_DEFAULTS.baseUrl;
    return buildOpenAICompatibleUrl(baseUrl, apiType);
  }
  if (isAnthropicCompatible(provider)) {
    const baseUrl = options?.baseUrl || ANTHROPIC_COMPATIBLE_DEFAULTS.baseUrl;
    return buildAnthropicCompatibleUrl(baseUrl);
  }
  const config = getProviderConfig(provider);

  switch (provider) {
    case "claude":
      return `${config.baseUrl}?beta=true`;

    case "gemini": {
      const action = stream ? "streamGenerateContent?alt=sse" : "generateContent";
      return `${config.baseUrl}/${model}:${action}`;
    }

    case "gemini-cli": {
      const action = stream ? "streamGenerateContent?alt=sse" : "generateContent";
      return `${config.baseUrl}:${action}`;
    }

    case "antigravity": {
      // Use baseUrlIndex from options or default to 0
      const urlIndex = options?.baseUrlIndex || 0;
      const baseUrls = config.baseUrls || [];
      const baseUrl = baseUrls[urlIndex] || baseUrls[0];
      const path = stream
        ? "/v1internal:streamGenerateContent?alt=sse"
        : "/v1internal:generateContent";
      return `${baseUrl}${path}`;
    }

    case "codex":
      return config.baseUrl;

    case "qwen": {
      const baseUrl = buildQwenBaseUrl(options?.qwenResourceUrl, config.baseUrl);
      return `${baseUrl}/chat/completions`;
    }

    case "github":
      return config.baseUrl;

    case "glm":
    case "kimi":
    case "minimax":
      // Claude-compatible providers
      return `${config.baseUrl}?beta=true`;

    default:
      return config.baseUrl;
  }
}

// Build provider headers
export function buildProviderHeaders(
  provider: string,
  credentials: ProviderCredentials,
  stream: boolean = true,
  _body: unknown = null,
) {
  const config = getProviderConfig(provider);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...config.headers,
  };

  // Add auth header
  // Specific override for Anthropic Compatible
  if (isAnthropicCompatible(provider)) {
    if (credentials.apiKey) {
      headers["x-api-key"] = credentials.apiKey;
      // Do NOT send Authorization header when apiKey is present for Anthropic Compatible
      // as it causes issues with some providers (e.g. opencode.ai)
    } else if (credentials.accessToken) {
      headers["Authorization"] = `Bearer ${credentials.accessToken}`;
    }
    // Add default Anthropic version if not present (some proxies require it)
    if (!headers["anthropic-version"]) {
      headers["anthropic-version"] = "2023-06-01";
    }
  } else {
    switch (provider) {
      case "gemini":
        if (credentials.apiKey) {
          headers["x-goog-api-key"] = credentials.apiKey;
        } else if (credentials.accessToken) {
          headers["Authorization"] = `Bearer ${credentials.accessToken}`;
        }
        break;

      case "antigravity":
      case "gemini-cli":
        // Antigravity and Gemini CLI use OAuth access token
        headers["Authorization"] = `Bearer ${credentials.accessToken}`;
        break;

      case "claude":
        // Claude uses x-api-key header for API key, or Authorization for OAuth
        if (credentials.apiKey) {
          headers["x-api-key"] = credentials.apiKey;
        } else if (credentials.accessToken) {
          headers["Authorization"] = `Bearer ${credentials.accessToken}`;
        }
        break;

      case "github": {
        // GitHub Copilot requires special headers to mimic VSCode
        // Prioritize copilotToken from providerSpecificData, fallback to accessToken
        const githubToken = credentials.copilotToken || credentials.accessToken;
        // Add headers in exact same order as test endpoint
        headers["Authorization"] = `Bearer ${githubToken}`;
        headers["Content-Type"] = "application/json";
        headers["copilot-integration-id"] = "vscode-chat";
        headers["editor-version"] = "vscode/1.107.1";
        headers["editor-plugin-version"] = "copilot-chat/0.26.7";
        headers["user-agent"] = "GitHubCopilotChat/0.26.7";
        headers["openai-intent"] = "conversation-panel";
        headers["x-github-api-version"] = "2025-04-01";
        // Generate a UUID for x-request-id (Cloudflare Workers compatible)
        headers["x-request-id"] = crypto.randomUUID
          ? crypto.randomUUID()
          : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c: string) => {
              const r = (Math.random() * 16) | 0;
              const v = c === "x" ? r : (r & 0x3) | 0x8;
              return v.toString(16);
            });
        headers["x-vscode-user-agent-library-version"] = "electron-fetch";
        headers["X-Initiator"] = "user";
        headers["Accept"] = "application/json";
        break;
      }

      case "codex":
      case "qwen":
      case "openai":
      case "openrouter":
        headers["Authorization"] = `Bearer ${credentials.apiKey || credentials.accessToken}`;
        break;

      case "cline":
        Object.assign(headers, buildClineHeaders(credentials.apiKey || credentials.accessToken));
        break;

      case "glm":
      case "kimi":
      case "minimax":
        // Claude-compatible API providers use x-api-key
        headers["x-api-key"] = credentials.apiKey;
        break;

      case "vertex":
      case "vertex-partner":
        // Vertex uses async token minting — headers are set by VertexExecutor._buildHeadersAsync()
        // Do NOT set Authorization here; it would leak the raw SA JSON as Bearer token
        break;

      default:
        headers["Authorization"] = `Bearer ${credentials.apiKey || credentials.accessToken}`;
        break;
    }
  }

  // Stream accept header
  if (stream) {
    headers["Accept"] = "text/event-stream";
  }

  return headers;
}

// Get target format for provider
export function getTargetFormat(provider: string) {
  if (isOpenAICompatible(provider)) {
    return getOpenAICompatibleType(provider) === "responses" ? "openai-responses" : "openai";
  }
  if (isAnthropicCompatible(provider)) {
    return "claude";
  }
  const config = getProviderConfig(provider);
  return config.format || "openai";
}

// Check if last message is from user
export function isLastMessageFromUser(body: RequestBody) {
  const messages = Array.isArray(body.messages)
    ? body.messages
    : Array.isArray(body.contents)
      ? (body.contents as Message[])
      : [];
  if (!messages?.length) return true;
  const lastMsg = messages[messages.length - 1];
  return lastMsg?.role === "user";
}

// Check if request has thinking config
export function hasThinkingConfig(body: RequestBody) {
  return !!(body.reasoning_effort || body.thinking?.type === "enabled");
}

// Normalize thinking config based on last message role
// - If lastMessage is not user → remove thinking config
// - If lastMessage is user AND has thinking config → keep it (force enable)
export function normalizeThinkingConfig(body: RequestBody) {
  const mutableBody = asRecord(body) as RequestBody;
  if (!isLastMessageFromUser(body)) {
    delete mutableBody.reasoning_effort;
    delete mutableBody.thinking;
  }
  return mutableBody;
}
