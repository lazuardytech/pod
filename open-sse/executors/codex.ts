import { createHash } from "node:crypto";
import { getConsistentMachineId } from "../../src/shared/utils/machineId";
import { CODEX_DEFAULT_INSTRUCTIONS } from "../config/codexInstructions.js";
import { getModelUpstreamId } from "../config/providerModels.js";
import { PROVIDERS } from "../config/providers.js";
import { DEFAULT_RETRY_CONFIG, resolveRetryEntry } from "../config/runtimeConfig.js";
import { fetchImageAsBase64 } from "../translator/helpers/imageHelper.js";
import { normalizeResponsesInput } from "../translator/helpers/responsesApiHelper.js";
import { dbg } from "../utils/debugLog.js";
import {
  BaseExecutor,
  type ExecutorCredentials,
  type ExecutorErrorDetails,
  type ExecutorExecuteOptions,
  type ExecutorExecuteResult,
  type ExecutorHeaders,
} from "./base.js";

type MutableRecord = Record<string, unknown>;

type CodexBody = MutableRecord & {
  _compact?: unknown;
  conversation_id?: unknown;
  include?: unknown[];
  input?: unknown;
  instructions?: string;
  model?: string;
  prompt_cache_key?: unknown;
  reasoning?: MutableRecord;
  reasoning_effort?: unknown;
  session_id?: unknown;
  store?: boolean;
  stream?: boolean;
  tool_choice?: unknown;
  tools?: unknown;
};

type CodexInputItem = MutableRecord & {
  content?: unknown;
  id?: string;
  role?: string;
  type?: string;
};

type CodexTool = MutableRecord & {
  description?: unknown;
  function?: MutableRecord;
  name?: unknown;
  parameters?: unknown;
  tools?: Array<{ name?: unknown }>;
  type?: unknown;
};

type ImageContent = MutableRecord & {
  detail?: string;
  image_url?: string | { detail?: string; url?: string };
  type?: string;
};

type CachedSession = {
  lastUsed: number;
  sessionId: string;
};

type PeekSseResult = {
  matched: string | null;
  replacementBody: ReadableStream<Uint8Array> | null;
};

// SSE error patterns inside 200-OK body that should trigger retry as if 503
const CODEX_SSE_OVERLOADED_PATTERNS = ["server_is_overloaded", "service_unavailable_error"];
const CODEX_SSE_PEEK_BYTES = 4096;

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

// In-memory map: hash(machineId + first assistant content) -> { sessionId, lastUsed }
const SESSION_TTL_MS = 60 * 60 * 1000; // 1 hour
const assistantSessionMap = new Map<string, CachedSession>();

// Server-generated item id prefixes that Codex /responses cannot resolve when store=false
const SERVER_ID_PATTERN = /^(rs|fc|resp|msg)_/;

// Hosted tool types that Codex/OpenAI Responses executes server-side
const CODEX_HOSTED_TOOL_TYPES = new Set([
  "image_generation",
  "web_search",
  "web_search_preview",
  "file_search",
  "computer",
  "computer_use_preview",
  "code_interpreter",
  "mcp",
  "local_shell",
]);

// Allowlist of fields accepted by Codex Responses API -- anything else is stripped
const RESPONSES_API_ALLOWLIST = new Set([
  "model",
  "input",
  "instructions",
  "tools",
  "tool_choice",
  "stream",
  "store",
  "reasoning",
  "service_tier",
  "include",
  "prompt_cache_key",
  "client_metadata",
]);

// Convert role=system -> role=developer in body.input (keeps content in cacheable prefix)
function convertSystemToDeveloperRole(body: CodexBody) {
  if (!Array.isArray(body.input)) return;
  for (const item of body.input as CodexInputItem[]) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const isSystemMsg = item.role === "system" && (!item.type || item.type === "message");
    if (isSystemMsg) item.role = "developer";
  }
}

// Strip server-generated item IDs (rs_/fc_/resp_/msg_) from input -- avoids 404 with store=false
function stripStoredItemReferences(body: CodexBody) {
  if (!Array.isArray(body.input)) return;
  body.input = body.input.filter((item: unknown) => {
    if (typeof item === "string" && SERVER_ID_PATTERN.test(item)) return false;
    if (item && typeof item === "object" && !Array.isArray(item)) {
      const record = item as CodexInputItem;
      if (record.type === "item_reference") return false;
      if (typeof record.id === "string" && SERVER_ID_PATTERN.test(record.id)) delete record.id;
    }
    return true;
  });
}

// Flatten Chat-Completions tool shape into Responses flat format + filter unsupported tools
function normalizeCodexTools(body: CodexBody) {
  if (!Array.isArray(body.tools)) return;
  const validNames = new Set<string>();
  body.tools = body.tools.filter((tool: unknown) => {
    if (!tool || typeof tool !== "object" || Array.isArray(tool)) return false;
    const record = tool as CodexTool;
    const type = typeof record.type === "string" ? record.type : "";
    if (type === "namespace") {
      if (Array.isArray(record.tools)) {
        for (const st of record.tools) {
          const n = typeof st?.name === "string" ? st.name.trim().slice(0, 128) : "";
          if (n) validNames.add(n);
        }
      }
      return true;
    }
    if (type !== "function") {
      if (!type || record.function || typeof record.name === "string") return false;
      return CODEX_HOSTED_TOOL_TYPES.has(type);
    }
    // Normalize function tool shape (handle both Chat Completions and Responses schemas)
    const fn =
      record.function && typeof record.function === "object" && !Array.isArray(record.function)
        ? record.function
        : null;
    const rawName =
      typeof record.name === "string" ? record.name : typeof fn?.name === "string" ? fn.name : "";
    const name = rawName.trim();
    if (!name) return false;
    const description =
      typeof record.description === "string"
        ? record.description
        : typeof fn?.description === "string"
          ? fn.description
          : "";
    const parameters =
      record.parameters &&
      typeof record.parameters === "object" &&
      !Array.isArray(record.parameters)
        ? record.parameters
        : fn?.parameters && typeof fn.parameters === "object" && !Array.isArray(fn.parameters)
          ? fn.parameters
          : { type: "object", properties: {} };
    // Drop old keys, set canonical shape
    for (const k of Object.keys(record)) delete record[k];
    record.type = "function";
    record.name = name.slice(0, 128);
    if (description) record.description = description;
    record.parameters = parameters;
    validNames.add(name);
    return true;
  });
  // Drop tool_choice if it references an unknown function name
  if (
    body.tool_choice &&
    typeof body.tool_choice === "object" &&
    !Array.isArray(body.tool_choice)
  ) {
    const toolChoice = body.tool_choice as MutableRecord;
    if (toolChoice.type === "function") {
      const n = typeof toolChoice.name === "string" ? toolChoice.name.trim() : "";
      if (!n || !validNames.has(n)) delete body.tool_choice;
    }
  }
}

// Cache machine ID at module level (resolved once)
let cachedMachineId: string | null = null;
getConsistentMachineId()
  .then((id: string) => {
    cachedMachineId = id;
  })
  .catch(() => {
    // Best-effort machine ID warmup; request-time fallback still resolves it.
  });

function hashContent(text: string) {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

function generateSessionId() {
  const bytes = new Uint8Array(5);
  crypto.getRandomValues(bytes);
  const rand = Array.from(bytes, (b) => b.toString(36))
    .join("")
    .slice(0, 7);
  return `sess_${Date.now().toString(36)}_${rand}`;
}

// Extract text content from an input item
function extractItemText(item: unknown) {
  if (!item) return "";
  const record = item as CodexInputItem;
  if (typeof record.content === "string") return record.content;
  if (Array.isArray(record.content)) {
    return record.content
      .map((c: unknown) => {
        const contentPart = c as { output?: unknown; text?: unknown };
        return typeof contentPart.text === "string"
          ? contentPart.text
          : typeof contentPart.output === "string"
            ? contentPart.output
            : "";
      })
      .filter(Boolean)
      .join("");
  }
  return "";
}

// Normalize a session id candidate (trim, length cap)
function normalizeSessionId(value: unknown) {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (!v || v.length > 256) return null;
  return v;
}

// Resolve prompt-cache session id with priority: body -> assistant-text-hash -> workspaceId -> machineId
function resolveCacheSessionId(
  body: CodexBody,
  credentials: ExecutorCredentials | null | undefined,
  machineId: string | null,
) {
  // 1. Client-provided session/conversation id (highest priority -- stable per conversation)
  const fromBody =
    normalizeSessionId(body?.prompt_cache_key) ||
    normalizeSessionId(body?.session_id) ||
    normalizeSessionId(body?.conversation_id);
  if (fromBody) return fromBody;

  // 2. Hash accumulated assistant text (>=50 chars) -- sticky session across turns
  if (Array.isArray(body?.input) && body.input.length > 0) {
    let text = "";
    const MIN_LEN = 50;
    const CAP_LEN = 200;
    for (const item of body.input) {
      const inputItem = item as CodexInputItem;
      if (inputItem?.role !== "assistant") continue;
      const t = extractItemText(inputItem);
      if (!t) continue;
      text += t;
      if (text.length >= CAP_LEN) break;
    }
    if (text.length >= MIN_LEN) {
      const hash = hashContent((machineId || "") + text.slice(0, CAP_LEN));
      const entry = assistantSessionMap.get(hash);
      if (entry) {
        entry.lastUsed = Date.now();
        return entry.sessionId;
      }
      const sessionId = generateSessionId();
      assistantSessionMap.set(hash, { sessionId, lastUsed: Date.now() });
      return sessionId;
    }
  }

  // 3. Account-wide fallback (workspaceId from connection)
  const workspaceId = normalizeSessionId(credentials?.providerSpecificData?.workspaceId);
  if (workspaceId) return workspaceId;

  // 4. Last resort -- stable per-machine id
  return machineId ? `sess_${hashContent(machineId)}` : generateSessionId();
}

// Cleanup expired entries periodically
setInterval(
  () => {
    const now = Date.now();
    for (const [key, entry] of assistantSessionMap) {
      if (now - entry.lastUsed > SESSION_TTL_MS) assistantSessionMap.delete(key);
    }
  },
  10 * 60 * 1000,
).unref();

/**
 * Codex Executor - handles OpenAI Codex API (Responses API format)
 * Automatically injects default instructions if missing
 */
export class CodexExecutor extends BaseExecutor {
  private _currentSessionId: string | null;
  private _isCompact = false;

  constructor() {
    super("codex", PROVIDERS.codex);
    this._currentSessionId = null;
  }

  /**
   * Override headers to add codex-specific identity headers.
   * transformRequest runs BEFORE buildHeaders, sets this._currentSessionId.
   */
  buildHeaders(credentials: ExecutorCredentials, _stream = true): ExecutorHeaders {
    // Codex always returns SSE regardless of client stream preference.
    // Force stream=true so base.js sets Accept: text/event-stream -- without it
    // Codex returns a non-JSON, non-SSE response that fails both parse paths.
    const headers = super.buildHeaders(credentials, true);
    headers["session_id"] = this._currentSessionId || credentials?.connectionId || "default";
    // Identify client type to Codex backend (matches official codex CLI)
    if (!headers["originator"]) headers["originator"] = "codex_cli_rs";
    // Workspace binding header -- improves account scope + cache affinity
    const workspaceId = credentials?.providerSpecificData?.workspaceId;
    if (typeof workspaceId === "string" && workspaceId && !headers["chatgpt-account-id"]) {
      headers["chatgpt-account-id"] = workspaceId;
    }
    return headers;
  }

  buildUrl(
    model: string,
    stream: boolean,
    urlIndex = 0,
    credentials: ExecutorCredentials | null = null,
  ): string | undefined {
    const base = super.buildUrl(model, stream, urlIndex, credentials);
    return this._isCompact ? `${base}/compact` : base;
  }

  /**
   * Prefetch remote image URLs and inline them as base64 data URIs.
   * Runs before execute() because Codex backend cannot fetch remote images.
   * Mutates body.input in place.
   */
  async prefetchImages(body: CodexBody) {
    if (!Array.isArray(body?.input)) return;
    for (const item of body.input as CodexInputItem[]) {
      if (!Array.isArray(item.content)) continue;
      const pending = item.content.map(async (entry: unknown) => {
        const c = entry as ImageContent;
        if (c.type !== "image_url") return c;
        const url = typeof c.image_url === "string" ? c.image_url : c.image_url?.url;
        const detail = typeof c.image_url === "string" ? "auto" : c.image_url?.detail || "auto";
        if (!url) return c;
        if (url.startsWith("data:")) return { type: "input_image", image_url: url, detail };
        const fetched = await fetchImageAsBase64(url, { timeoutMs: 15000 });
        return { type: "input_image", image_url: fetched?.url || url, detail };
      });
      item.content = await Promise.all(pending);
    }
  }

  async execute(args: ExecutorExecuteOptions): Promise<ExecutorExecuteResult> {
    const body = args.body as CodexBody;
    const imgCount = Array.isArray(body?.input)
      ? (body.input as CodexInputItem[]).reduce(
          (n: number, it) =>
            n +
            (Array.isArray(it.content)
              ? it.content.filter((c: unknown) => (c as ImageContent).type === "image_url").length
              : 0),
          0,
        )
      : 0;
    const inputLen = Array.isArray(body?.input) ? body.input.length : 0;
    dbg(
      "CODEX",
      `execute start | inputItems=${inputLen} | images=${imgCount} | sessionId=${this._currentSessionId || "pending"}`,
    );
    if (imgCount > 0) {
      const t0 = Date.now();
      await this.prefetchImages(body);
      dbg("CODEX", `prefetchImages done | ${Date.now() - t0}ms`);
    } else {
      await this.prefetchImages(body);
    }

    // Retry loop for SSE-level overloaded errors (200 OK body contains event: error)
    // Reuses 503 retry config -- same semantic: upstream temporarily unavailable
    const retryConfig = { ...DEFAULT_RETRY_CONFIG, ...this.config.retry };
    const { attempts, delayMs } = resolveRetryEntry(retryConfig[503]);
    let attempt = 0;
    while (true) {
      const result = await super.execute(args);
      const peek = await this._peekSseOverloaded(result.response);
      if (!peek.matched) {
        // Replace body with re-assembled stream (prefix bytes already read + rest)
        if (peek.replacementBody) {
          result.response = new Response(peek.replacementBody, {
            status: result.response.status,
            statusText: result.response.statusText,
            headers: result.response.headers,
          });
        }
        return result;
      }
      if (attempt >= attempts) {
        args.log?.warn?.(
          "RETRY",
          `CODEX | SSE overloaded "${peek.matched}" -- retries exhausted (${attempt}/${attempts})`,
        );
        // Out of retries -> return with replacement body so client gets the error
        if (peek.replacementBody) {
          result.response = new Response(peek.replacementBody, {
            status: result.response.status,
            statusText: result.response.statusText,
            headers: result.response.headers,
          });
        }
        return result;
      }
      attempt++;
      args.log?.debug?.(
        "RETRY",
        `CODEX | SSE "${peek.matched}" retry ${attempt}/${attempts} after ${delayMs / 1000}s`,
      );
      dbg(
        "CODEX",
        `SSE overloaded "${peek.matched}" -> retry ${attempt}/${attempts} in ${delayMs}ms`,
      );
      try {
        await result.response.body?.cancel?.();
      } catch {
        // Cleanup only; the retry will issue a fresh upstream request.
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  // Peek first N bytes of SSE body to detect upstream "overloaded" errors.
  // Returns { matched: string|null, replacementBody: ReadableStream|null }.
  // Caller MUST use replacementBody (original body has been read).
  // Uses TransformStream to avoid fragile releaseLock+getReader double-reader pattern.
  async _peekSseOverloaded(response: Response): Promise<PeekSseResult> {
    if (!response || !response.ok || !response.body)
      return { matched: null, replacementBody: null };
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const chunks: Uint8Array[] = [];
    let text = "";
    let matched: string | null = null;
    try {
      while (text.length < CODEX_SSE_PEEK_BYTES) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        text += decoder.decode(value, { stream: true });
        const hit = CODEX_SSE_OVERLOADED_PATTERNS.find((p) => text.includes(p));
        if (hit) {
          matched = hit;
          break;
        }
      }
    } catch (e: unknown) {
      dbg("CODEX", `peek read error: ${errorMessage(e)}`);
    }
    // Re-assemble stream via TransformStream — single reader, no releaseLock+getReader.
    // Write peeked chunks first, then read remaining from same reader, then close.
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const writer = writable.getWriter();
    for (const c of chunks) {
      writer.write(c);
    }
    // Drain rest of body from the same reader, then close.
    (async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          await writer.write(value);
        }
      } catch (e: unknown) {
        await writer.abort(e).catch(() => {
          // Cleanup only; reader drain already failed.
        });
        return;
      }
      await writer.close();
    })();

    return { matched, replacementBody: readable };
  }

  // Parse Codex usage_limit_reached to extract precise resetsAtMs; fallback to default otherwise
  parseError(response: Response, bodyText: string): ExecutorErrorDetails {
    if (response.status === 429 && bodyText) {
      try {
        const json = JSON.parse(bodyText) as {
          error?: {
            message?: string;
            resets_at?: number;
            resets_in_seconds?: number;
            type?: string;
          };
        };
        const err = json?.error;
        if (err?.type === "usage_limit_reached") {
          const now = Date.now();
          let resetsAtMs: number | null = null;
          if (typeof err.resets_at === "number" && err.resets_at > 0) {
            const ms = err.resets_at * 1000;
            if (ms > now) resetsAtMs = ms;
          }
          if (
            !resetsAtMs &&
            typeof err.resets_in_seconds === "number" &&
            err.resets_in_seconds > 0
          ) {
            resetsAtMs = now + err.resets_in_seconds * 1000;
          }
          if (resetsAtMs) {
            return { status: 429, message: err.message || bodyText, resetsAtMs };
          }
        }
      } catch {
        /* fall through to default */
      }
    }
    return super.parseError(response, bodyText);
  }

  /**
   * Transform request before sending - inject default instructions if missing.
   * Image fetching is handled separately in prefetchImages() so this stays sync.
   */
  transformRequest(
    model: string,
    rawBody: unknown,
    _stream: boolean,
    credentials: ExecutorCredentials,
  ): CodexBody {
    const body = rawBody as CodexBody;
    this._isCompact = !!body._compact;
    delete body._compact;
    // Resolve conversation-stable session_id (priority: body -> assistant-text-hash -> workspace -> machine)
    this._currentSessionId = resolveCacheSessionId(body, credentials, cachedMachineId);
    // Convert string input to array format (Codex API requires input as array)
    const normalized = normalizeResponsesInput(body.input);
    if (normalized) body.input = normalized;

    // Ensure input is present and non-empty (Codex API rejects empty input)
    if (!body.input || (Array.isArray(body.input) && body.input.length === 0)) {
      body.input = [
        { type: "message", role: "user", content: [{ type: "input_text", text: "..." }] },
      ];
    }

    // Keep system prompts in body.input as role=developer so they stay in the cacheable prefix
    convertSystemToDeveloperRole(body);
    // Strip server-generated item IDs (rs_/fc_/resp_/msg_) -- Codex /responses can't resolve when store=false
    stripStoredItemReferences(body);
    // Flatten function tools + drop unsupported types
    normalizeCodexTools(body);

    // Ensure streaming is enabled (Codex API requires it)
    body.stream = true;

    // If no instructions provided, inject default Codex instructions
    if (!body.instructions || body.instructions.trim() === "") {
      body.instructions = CODEX_DEFAULT_INSTRUCTIONS;
    }

    // Ensure store is false (Codex requirement)
    body.store = false;

    // Inject prompt_cache_key for stable Codex prompt caching
    if (!body.prompt_cache_key && this._currentSessionId) {
      body.prompt_cache_key = this._currentSessionId;
    }

    // Map virtual Codex review models to the upstream Codex model before suffix parsing.
    let requestModel = getModelUpstreamId(
      "cx",
      typeof body.model === "string" ? body.model : model,
    );
    body.model = requestModel;

    // Extract thinking level from model name suffix
    // e.g., gpt-5.3-codex-high -> high, gpt-5.3-codex -> medium (default)
    const effortLevels = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];
    let modelEffort: string | null = null;
    for (const level of effortLevels) {
      if (requestModel.endsWith(`-${level}`)) {
        modelEffort = level;
        // Strip suffix from model name for actual API call
        requestModel = requestModel.replace(`-${level}`, "");
        body.model = requestModel;
        break;
      }
    }

    // Normalize: UI/client sends "extra-high" but Codex API expects "xhigh"
    const EFFORT_ALIASES: Record<string, string> = {
      "extra-high": "xhigh",
      extrahigh: "xhigh",
      "very-high": "xhigh",
      maximum: "max",
    };

    // Normalize reasoning_effort before use
    if (body.reasoning_effort) {
      const raw = String(body.reasoning_effort).toLowerCase();
      body.reasoning_effort = EFFORT_ALIASES[raw] || raw;
    }

    // Priority: explicit reasoning.effort > reasoning_effort param > model suffix > default (low)
    if (!body.reasoning) {
      const effort =
        typeof body.reasoning_effort === "string" ? body.reasoning_effort : modelEffort || "low";
      body.reasoning = { effort, summary: "auto" };
    } else if (!body.reasoning.summary) {
      body.reasoning.summary = "auto";
    } else {
      // Normalize reasoning.effort inline
      if (body.reasoning.effort) {
        const raw = String(body.reasoning.effort).toLowerCase();
        body.reasoning.effort = EFFORT_ALIASES[raw] || raw;
      }
    }
    delete body.reasoning_effort;

    // Include reasoning encrypted content (required by Codex backend for reasoning models).
    // Preserve any existing include values from the client.
    if (body.reasoning && body.reasoning.effort && body.reasoning.effort !== "none") {
      const reasoningInclude = "reasoning.encrypted_content";
      if (Array.isArray(body.include)) {
        if (!body.include.includes(reasoningInclude)) {
          body.include.push(reasoningInclude);
        }
      } else {
        body.include = [reasoningInclude];
      }
    }

    // Remove unsupported parameters for Codex API
    delete body.temperature;
    delete body.top_p;
    delete body.frequency_penalty;
    delete body.presence_penalty;
    delete body.logprobs;
    delete body.top_logprobs;
    delete body.n;
    delete body.seed;
    delete body.max_tokens;
    delete body.max_completion_tokens;
    delete body.max_output_tokens; // Codex rejects this even when Responses API clients send it
    delete body.user; // Cursor sends this but Codex doesn't support it
    delete body.prompt_cache_retention; // Cursor sends this but Codex doesn't support it
    delete body.metadata; // Cursor sends this but Codex doesn't support it
    delete body.stream_options; // Cursor sends this but Codex doesn't support it
    delete body.safety_identifier; // Droid CLI sends this but Codex doesn't support it
    delete body.previous_response_id; // store=false -> backend can't resolve previous response; avoid 404

    // Final allowlist filter -- strip any unknown field that could trigger upstream "routing_unsupported" error
    for (const k of Object.keys(body)) {
      if (!RESPONSES_API_ALLOWLIST.has(k)) delete body[k];
    }

    return body;
  }
}
