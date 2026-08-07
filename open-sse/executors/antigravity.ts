// @ts-nocheck
import crypto from "node:crypto";
import {
  AG_DEFAULT_TOOLS,
  AG_TOOL_SUFFIX,
  ANTIGRAVITY_HEADERS,
  INTERNAL_REQUEST_HEADER,
  OAUTH_ENDPOINTS,
} from "../config/appConstants.js";
import { PROVIDERS } from "../config/providers.js";
import { HTTP_STATUS } from "../config/runtimeConfig.js";
import { cleanJSONSchemaForAntigravity } from "../translator/helpers/geminiHelper.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { deriveSessionId } from "../utils/sessionManager.js";
import {
  BaseExecutor,
  type ExecutorCredentials,
  type ExecutorExecuteOptions,
  type ExecutorHeaders,
  type ExecutorLogger,
  type ExecutorProxyOptions,
} from "./base.js";

type JsonRecord = Record<string, unknown>;
type FunctionDeclaration = JsonRecord & {
  name: string;
  parameters?: JsonRecord;
};
type ToolGroup = {
  functionDeclarations?: FunctionDeclaration[];
};
type ContentPart = JsonRecord & {
  functionCall?: { name: string; [key: string]: unknown };
  functionResponse?: { name: string; [key: string]: unknown };
  text?: unknown;
  thought?: unknown;
  thoughtSignature?: unknown;
};
type Content = JsonRecord & {
  parts?: ContentPart[];
  role?: string;
};
type AntigravityRequest = JsonRecord & {
  contents?: Content[];
  generationConfig?: JsonRecord & { maxOutputTokens?: number };
  sessionId?: string;
  toolConfig?: unknown;
  tools?: ToolGroup[];
};
type AntigravityBody = JsonRecord & {
  project?: string;
  request?: AntigravityRequest;
  requestId?: string;
  requestType?: string;
  userAgent?: string;
};
type AntigravityCredentials = ExecutorCredentials & {
  connectionId?: string;
  email?: string;
  projectId?: string;
};
type OAuthTokenPayload = {
  access_token?: unknown;
  expires_in?: unknown;
  refresh_token?: unknown;
};
type CloakResult = {
  cloakedBody: AntigravityBody;
  toolNameMap: Map<string, string> | null;
};

function asAntigravityBody(body: unknown): AntigravityBody {
  return body && typeof body === "object" && !Array.isArray(body) ? (body as AntigravityBody) : {};
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

// Sanitize function name: Gemini requires [a-zA-Z_][a-zA-Z0-9_.:\-]{0,63}
function sanitizeFunctionName(name: string) {
  if (!name) return "_unknown";
  let s = name.replace(/[^a-zA-Z0-9_.:-]/g, "_");
  if (!/^[a-zA-Z_]/.test(s)) s = "_" + s;
  return s.substring(0, 64);
}

const MAX_RETRY_AFTER_MS = 10000;
const MAX_ANTIGRAVITY_OUTPUT_TOKENS = 16384;

export class AntigravityExecutor extends BaseExecutor {
  constructor() {
    super("antigravity", PROVIDERS.antigravity);
  }

  buildUrl(_model: string, stream: boolean, urlIndex: number = 0) {
    const baseUrls = this.getBaseUrls();
    const baseUrl = baseUrls[urlIndex] || baseUrls[0];
    const action = stream ? "streamGenerateContent?alt=sse" : "generateContent";
    return `${baseUrl}/v1internal:${action}`;
  }

  buildHeaders(
    credentials: ExecutorCredentials,
    stream: boolean = true,
    sessionId: string | null = null,
  ): ExecutorHeaders {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${credentials.accessToken}`,
      "User-Agent": this.config.headers?.["User-Agent"] || ANTIGRAVITY_HEADERS["User-Agent"],
      [INTERNAL_REQUEST_HEADER.name]: INTERNAL_REQUEST_HEADER.value,
      ...(sessionId && { "X-Machine-Session-Id": sessionId }),
      Accept: stream ? "text/event-stream" : "application/json",
    };
  }

  transformRequest(
    model: string,
    body: unknown,
    _stream: boolean,
    credentials: AntigravityCredentials,
  ): AntigravityBody {
    const antigravityBody = asAntigravityBody(body);
    const projectId = credentials?.projectId || this.generateProjectId();

    // Fix contents for Claude models via Antigravity
    const contents = antigravityBody.request?.contents?.map((c) => {
      let role = c.role;
      // functionResponse must be role "user" for Claude models
      if (c.parts?.some((p) => p.functionResponse)) {
        role = "user";
      }
      // Strip thought-only parts, keep thoughtSignature on functionCall parts (Gemini 3+ requires it)
      const parts = c.parts?.filter((p) => {
        if (p.thought && !p.functionCall) return false;
        if (p.thoughtSignature && !p.functionCall && !p.text) return false;
        return true;
      });
      if (role !== c.role || parts?.length !== c.parts?.length) {
        return { ...c, role, parts };
      }
      return c;
    });

    // Sanitize tool schemas and function names before sending to Antigravity.
    let tools = antigravityBody.request?.tools;

    if (tools && tools.length > 0) {
      // Merge all groups into a single functionDeclarations group (Gemini expects 1 group)
      const allDeclarations = tools.flatMap((group) =>
        (group.functionDeclarations || []).map((fn) => ({
          ...fn,
          name: sanitizeFunctionName(fn.name),
          parameters: fn.parameters
            ? cleanJSONSchemaForAntigravity(structuredClone(fn.parameters))
            : {
                type: "object",
                properties: { reason: { type: "string", description: "Brief explanation" } },
                required: ["reason"],
              },
        })),
      );
      tools = allDeclarations.length > 0 ? [{ functionDeclarations: allDeclarations }] : [];
    }

    const {
      tools: _originalTools,
      toolConfig: _originalToolConfig,
      ...requestWithoutTools
    } = antigravityBody.request || {};
    const generationConfig = { ...(requestWithoutTools.generationConfig || {}) };
    if (generationConfig.maxOutputTokens > MAX_ANTIGRAVITY_OUTPUT_TOKENS) {
      generationConfig.maxOutputTokens = MAX_ANTIGRAVITY_OUTPUT_TOKENS;
    }

    const transformedRequest = {
      ...requestWithoutTools,
      generationConfig,
      ...(contents && { contents }),
      ...(tools && { tools }),
      sessionId:
        antigravityBody.request?.sessionId ||
        deriveSessionId(credentials?.email || credentials?.connectionId),
      safetySettings: undefined,
      ...(tools?.length > 0 && { toolConfig: { functionCallingConfig: { mode: "VALIDATED" } } }),
    };

    return {
      ...antigravityBody,
      project: projectId,
      model: model,
      userAgent: "antigravity",
      requestType: "agent",
      requestId: `agent-${crypto.randomUUID()}`,
      request: transformedRequest,
    };
  }

  async refreshCredentials(
    credentials: ExecutorCredentials,
    log: ExecutorLogger | null,
    proxyOptions: ExecutorProxyOptions = null,
  ) {
    if (!credentials.refreshToken) return null;

    try {
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
            refresh_token: credentials.refreshToken,
            client_id: String(this.config.clientId),
            client_secret: String(this.config.clientSecret),
          }),
        },
        proxyOptions,
      );

      if (!response.ok) return null;

      const tokens = (await response.json()) as OAuthTokenPayload;
      log?.info?.("TOKEN", "Antigravity refreshed");

      return {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || credentials.refreshToken,
        expiresIn: tokens.expires_in,
        projectId: credentials.projectId,
      };
    } catch (error: unknown) {
      log?.error?.("TOKEN", `Antigravity refresh error: ${errorMessage(error)}`);
      return null;
    }
  }

  generateProjectId() {
    const adj = ["useful", "bright", "swift", "calm", "bold"][Math.floor(Math.random() * 5)];
    const noun = ["fuze", "wave", "spark", "flow", "core"][Math.floor(Math.random() * 5)];
    return `${adj}-${noun}-${crypto.randomUUID().slice(0, 5)}`;
  }

  generateSessionId() {
    return crypto.randomUUID() + Date.now().toString();
  }

  parseRetryHeaders(headers: Headers | null) {
    if (!headers?.get) return null;

    const retryAfter = headers.get("retry-after");
    if (retryAfter) {
      const seconds = parseInt(retryAfter, 10);
      if (!Number.isNaN(seconds) && seconds > 0) return seconds * 1000;

      const date = new Date(retryAfter);
      if (!Number.isNaN(date.getTime())) {
        const diff = date.getTime() - Date.now();
        return diff > 0 ? diff : null;
      }
    }

    const resetAfter = headers.get("x-ratelimit-reset-after");
    if (resetAfter) {
      const seconds = parseInt(resetAfter, 10);
      if (!Number.isNaN(seconds) && seconds > 0) return seconds * 1000;
    }

    const resetTimestamp = headers.get("x-ratelimit-reset");
    if (resetTimestamp) {
      const ts = parseInt(resetTimestamp, 10) * 1000;
      const diff = ts - Date.now();
      return diff > 0 ? diff : null;
    }

    return null;
  }

  // Parse retry time from Antigravity error message body
  // Format: "Your quota will reset after 2h7m23s" or "1h30m" or "45m" or "30s"
  parseRetryFromErrorMessage(message: unknown) {
    if (!message || typeof message !== "string") return null;

    const match = message.match(/reset after (\d+h)?(\d+m)?(\d+s)?/i);
    if (!match) return null;

    let totalMs = 0;
    if (match[1]) totalMs += parseInt(match[1]) * 3600 * 1000; // hours
    if (match[2]) totalMs += parseInt(match[2]) * 60 * 1000; // minutes
    if (match[3]) totalMs += parseInt(match[3]) * 1000; // seconds

    return totalMs > 0 ? totalMs : null;
  }

  async execute({
    model,
    body,
    stream,
    credentials,
    signal,
    log,
    proxyOptions = null,
  }: ExecutorExecuteOptions) {
    const fallbackCount = this.getFallbackCount();
    let lastError: unknown = null;
    let lastStatus = 0;
    const MAX_AUTO_RETRIES = 3;
    const MAX_RETRY_AFTER_RETRIES = 3;
    const retryAttemptsByUrl: Record<number, number> = {}; // Track retry attempts per URL
    const retryAfterAttemptsByUrl: Record<number, number> = {}; // Track Retry-After retries per URL

    for (let urlIndex = 0; urlIndex < fallbackCount; urlIndex++) {
      const url = this.buildUrl(model, stream, urlIndex);
      const transformedBody = this.transformRequest(
        model,
        body,
        stream,
        credentials as AntigravityCredentials,
      );
      const sessionId = transformedBody.request?.sessionId;
      const headers = this.buildHeaders(credentials, stream, sessionId);

      // Initialize retry counters for this URL
      if (!retryAttemptsByUrl[urlIndex]) {
        retryAttemptsByUrl[urlIndex] = 0;
      }
      if (!retryAfterAttemptsByUrl[urlIndex]) {
        retryAfterAttemptsByUrl[urlIndex] = 0;
      }

      try {
        const response = await proxyAwareFetch(
          url,
          {
            method: "POST",
            headers,
            body: JSON.stringify(transformedBody),
            signal,
          },
          proxyOptions,
        );

        if (
          response.status === HTTP_STATUS.RATE_LIMITED ||
          response.status === HTTP_STATUS.SERVICE_UNAVAILABLE
        ) {
          // Try to get retry time from headers first
          let retryMs = this.parseRetryHeaders(response.headers);

          // If no retry time in headers, try to parse from error message body
          if (!retryMs) {
            try {
              const errorBody = await response.clone().text();
              const errorJson = JSON.parse(errorBody);
              const errorMessage = errorJson?.error?.message || errorJson?.message || "";
              retryMs = this.parseRetryFromErrorMessage(errorMessage);
            } catch {
              // Ignore parse errors, will fall back to exponential backoff
            }
          }

          if (
            retryMs &&
            retryMs <= MAX_RETRY_AFTER_MS &&
            retryAfterAttemptsByUrl[urlIndex] < MAX_RETRY_AFTER_RETRIES
          ) {
            retryAfterAttemptsByUrl[urlIndex]++;
            log?.debug?.(
              "RETRY",
              `${response.status} with Retry-After: ${Math.ceil(retryMs / 1000)}s, waiting... (${retryAfterAttemptsByUrl[urlIndex]}/${MAX_RETRY_AFTER_RETRIES})`,
            );
            await new Promise<void>((resolve) => setTimeout(resolve, retryMs));
            urlIndex--;
            continue;
          }

          // Auto retry only for 429 when retryMs is 0 or undefined
          if (
            response.status === HTTP_STATUS.RATE_LIMITED &&
            (!retryMs || retryMs === 0) &&
            retryAttemptsByUrl[urlIndex] < MAX_AUTO_RETRIES
          ) {
            retryAttemptsByUrl[urlIndex]++;
            // Exponential backoff: 2s, 4s, 8s...
            const backoffMs = Math.min(
              1000 * 2 ** retryAttemptsByUrl[urlIndex],
              MAX_RETRY_AFTER_MS,
            );
            log?.debug?.(
              "RETRY",
              `429 auto retry ${retryAttemptsByUrl[urlIndex]}/${MAX_AUTO_RETRIES} after ${backoffMs / 1000}s`,
            );
            await new Promise<void>((resolve) => setTimeout(resolve, backoffMs));
            urlIndex--;
            continue;
          }

          log?.debug?.(
            "RETRY",
            `${response.status}, Retry-After ${retryMs ? `too long (${Math.ceil(retryMs / 1000)}s)` : "missing"}, trying fallback`,
          );
          lastStatus = response.status;

          if (urlIndex + 1 < fallbackCount) {
            continue;
          }
        }

        if (this.shouldRetry(response.status, urlIndex)) {
          log?.debug?.("RETRY", `${response.status} on ${url}, trying fallback ${urlIndex + 1}`);
          lastStatus = response.status;
          continue;
        }

        return { response, url, headers, transformedBody };
      } catch (error: unknown) {
        lastError = error;
        if (urlIndex + 1 < fallbackCount) {
          log?.debug?.("RETRY", `Error on ${url}, trying fallback ${urlIndex + 1}`);
          continue;
        }
        throw error;
      }
    }

    throw lastError || new Error(`All ${fallbackCount} URLs failed with status ${lastStatus}`);
  }

  /**
   * Cloak tools before sending to Antigravity provider (anti-ban):
   * - Rename client tools with _ide suffix
   * - Inject AG default decoy tools after client tools
   * Returns { cloakedBody, toolNameMap } where toolNameMap maps suffixed → original
   */
  static cloakTools(body: AntigravityBody, clientTool: string | null = null): CloakResult {
    const tools = body.request?.tools;
    if (!tools || tools.length === 0) {
      return { cloakedBody: body, toolNameMap: null };
    }

    const isCopilot = clientTool === "github-copilot";
    const toolNameMap = new Map<string, string>();
    const clientDeclarations: FunctionDeclaration[] = [];
    const decoyNames = new Set(AG_DECOY_TOOLS.map((tool) => tool.name));

    // First: collect renamed client tools
    for (const toolGroup of tools) {
      if (!toolGroup.functionDeclarations) continue;

      for (const func of toolGroup.functionDeclarations) {
        // For GitHub Copilot, avoid emitting duplicate native Antigravity tool names.
        // Keep the decoys only once in the final declaration list.
        if (isCopilot && AG_DEFAULT_TOOLS.has(func.name)) {
          continue;
        }

        // Skip if already covered by decoys for Copilot
        if (isCopilot && decoyNames.has(func.name)) {
          continue;
        }

        // Preserve native AG names for non-Copilot clients
        if (AG_DEFAULT_TOOLS.has(func.name)) {
          clientDeclarations.push(func);
          continue;
        }

        const suffixed = `${func.name}${AG_TOOL_SUFFIX}`;
        toolNameMap.set(suffixed, func.name);
        clientDeclarations.push({ ...func, name: suffixed });
      }
    }

    // Client tools first, then AG decoy tools
    const allDeclarations: FunctionDeclaration[] = [];
    const seenNames = new Set<string>();
    for (const decl of [...clientDeclarations, ...AG_DECOY_TOOLS]) {
      if (!decl?.name || seenNames.has(decl.name)) continue;
      seenNames.add(decl.name);
      allDeclarations.push(decl);
    }

    // Rename tool names in conversation history (contents)
    const cloakedContents = body.request?.contents?.map((msg) => {
      if (!msg.parts) return msg;

      const cloakedParts = msg.parts.map((part) => {
        // Rename functionCall.name
        if (part.functionCall && !AG_DEFAULT_TOOLS.has(part.functionCall.name)) {
          return {
            ...part,
            functionCall: {
              ...part.functionCall,
              name: `${part.functionCall.name}${AG_TOOL_SUFFIX}`,
            },
          };
        }

        // Rename functionResponse.name
        if (part.functionResponse && !AG_DEFAULT_TOOLS.has(part.functionResponse.name)) {
          return {
            ...part,
            functionResponse: {
              ...part.functionResponse,
              name: `${part.functionResponse.name}${AG_TOOL_SUFFIX}`,
            },
          };
        }

        return part;
      });

      return { ...msg, parts: cloakedParts };
    });

    // Single functionDeclarations group: client tools first, then decoys
    return {
      cloakedBody: {
        ...body,
        request: {
          ...body.request,
          tools: [{ functionDeclarations: allDeclarations }],
          contents: cloakedContents || body.request.contents,
        },
      },
      toolNameMap,
    };
  }
}

// AG decoy tools — same names as AG native defaults, redirect to _ide suffixed tools
const AG_DECOY_TOOLS = [
  {
    name: "browser_subagent",
    description: "This tool is currently unavailable.",
    parameters: { type: "OBJECT", properties: {}, required: [] },
  },
  {
    name: "command_status",
    description: "This tool is currently unavailable.",
    parameters: { type: "OBJECT", properties: {}, required: [] },
  },
  {
    name: "find_by_name",
    description: "This tool is currently unavailable.",
    parameters: { type: "OBJECT", properties: {}, required: [] },
  },
  {
    name: "generate_image",
    description: "This tool is currently unavailable.",
    parameters: { type: "OBJECT", properties: {}, required: [] },
  },
  {
    name: "grep_search",
    description: "This tool is currently unavailable.",
    parameters: { type: "OBJECT", properties: {}, required: [] },
  },
  {
    name: "list_dir",
    description: "This tool is currently unavailable.",
    parameters: { type: "OBJECT", properties: {}, required: [] },
  },
  {
    name: "list_resources",
    description: "This tool is currently unavailable.",
    parameters: { type: "OBJECT", properties: {}, required: [] },
  },
  {
    name: "mcp_sequential-thinking_sequentialthinking",
    description: "This tool is currently unavailable.",
    parameters: { type: "OBJECT", properties: {}, required: [] },
  },
  {
    name: "multi_replace_file_content",
    description: "This tool is currently unavailable.",
    parameters: { type: "OBJECT", properties: {}, required: [] },
  },
  {
    name: "notify_user",
    description: "This tool is currently unavailable.",
    parameters: { type: "OBJECT", properties: {}, required: [] },
  },
  {
    name: "read_resource",
    description: "This tool is currently unavailable.",
    parameters: { type: "OBJECT", properties: {}, required: [] },
  },
  {
    name: "read_terminal",
    description: "This tool is currently unavailable.",
    parameters: { type: "OBJECT", properties: {}, required: [] },
  },
  {
    name: "read_url_content",
    description: "This tool is currently unavailable.",
    parameters: { type: "OBJECT", properties: {}, required: [] },
  },
  {
    name: "replace_file_content",
    description: "This tool is currently unavailable.",
    parameters: { type: "OBJECT", properties: {}, required: [] },
  },
  {
    name: "run_command",
    description: "This tool is currently unavailable.",
    parameters: { type: "OBJECT", properties: {}, required: [] },
  },
  {
    name: "search_web",
    description: "This tool is currently unavailable.",
    parameters: { type: "OBJECT", properties: {}, required: [] },
  },
  {
    name: "send_command_input",
    description: "This tool is currently unavailable.",
    parameters: { type: "OBJECT", properties: {}, required: [] },
  },
  {
    name: "task_boundary",
    description: "This tool is currently unavailable.",
    parameters: { type: "OBJECT", properties: {}, required: [] },
  },
  {
    name: "view_content_chunk",
    description: "This tool is currently unavailable.",
    parameters: { type: "OBJECT", properties: {}, required: [] },
  },
  {
    name: "view_file",
    description: "This tool is currently unavailable.",
    parameters: { type: "OBJECT", properties: {}, required: [] },
  },
  {
    name: "write_to_file",
    description: "This tool is currently unavailable.",
    parameters: { type: "OBJECT", properties: {}, required: [] },
  },
];

export default AntigravityExecutor;
