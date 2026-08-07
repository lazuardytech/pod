import { saveRequestUsage, saveRequestDetail } from "@/lib/usageDb";
import { COLORS } from "../../utils/stream.js";

type JsonRecord = Record<string, unknown>;
type DetailItem = Parameters<typeof saveRequestDetail>[0];

type UsageTokens = JsonRecord & {
  input_tokens?: number;
  output_tokens?: number;
  prompt_tokens?: number;
  completion_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  cached_tokens?: number;
  reasoning_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number };
  completion_tokens_details?: { reasoning_tokens?: number };
};

type ResponseBodyWithUsage = JsonRecord & {
  usage?: UsageTokens;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
  };
  prompt_eval_count?: number;
  eval_count?: number;
};

type RequestDetailBase = JsonRecord & {
  id?: string;
  provider?: string;
  model?: string;
  connectionId?: string;
  latency?: { ttft?: number; total?: number };
  tokens?: unknown;
  request?: unknown;
  providerRequest?: unknown;
  providerResponse?: unknown;
  response?: unknown;
  status?: string;
};

type SaveUsageStatsParams = {
  provider?: string | null;
  model?: string | null;
  tokens?: UsageTokens | null;
  connectionId?: string | null;
  apiKey?: string | null;
  endpoint?: string | null;
  label?: string;
};

const OPTIONAL_PARAMS = [
  "temperature",
  "top_p",
  "top_k",
  "max_tokens",
  "max_completion_tokens",
  "thinking",
  "reasoning",
  "enable_thinking",
  "presence_penalty",
  "frequency_penalty",
  "seed",
  "stop",
  "tools",
  "tool_choice",
  "response_format",
  "prediction",
  "store",
  "metadata",
  "n",
  "logprobs",
  "top_logprobs",
  "logit_bias",
  "user",
  "parallel_tool_calls",
] as const;

export function extractRequestConfig(body: JsonRecord | null | undefined, stream: unknown) {
  const safeBody = body && typeof body === "object" ? body : {};
  const config: JsonRecord = {
    messages: safeBody.messages || [],
    model: safeBody.model,
    stream,
  };
  for (const param of OPTIONAL_PARAMS) {
    if (safeBody[param] !== undefined) config[param] = safeBody[param];
  }
  return config;
}

export function extractUsageFromResponse(responseBody: unknown) {
  if (!responseBody || typeof responseBody !== "object") return null;
  const body = responseBody as ResponseBodyWithUsage;

  // Claude format
  if (body.usage?.input_tokens !== undefined) {
    return {
      prompt_tokens: body.usage.input_tokens || 0,
      completion_tokens: body.usage.output_tokens || 0,
      cache_read_input_tokens: body.usage.cache_read_input_tokens,
      cache_creation_input_tokens: body.usage.cache_creation_input_tokens,
    };
  }

  // OpenAI format
  if (body.usage?.prompt_tokens !== undefined) {
    return {
      prompt_tokens: body.usage.prompt_tokens || 0,
      completion_tokens: body.usage.completion_tokens || 0,
      cached_tokens: body.usage.prompt_tokens_details?.cached_tokens,
      reasoning_tokens: body.usage.completion_tokens_details?.reasoning_tokens,
    };
  }

  // Gemini format
  if (body.usageMetadata) {
    return {
      prompt_tokens: body.usageMetadata.promptTokenCount || 0,
      completion_tokens: body.usageMetadata.candidatesTokenCount || 0,
      reasoning_tokens: body.usageMetadata.thoughtsTokenCount,
    };
  }

  // Ollama format (non-streaming response with prompt_eval_count/eval_count)
  if (body.prompt_eval_count !== undefined || body.eval_count !== undefined) {
    return {
      prompt_tokens: body.prompt_eval_count || 0,
      completion_tokens: body.eval_count || 0,
    };
  }

  return null;
}

export function buildRequestDetail(
  base: RequestDetailBase,
  overrides: JsonRecord = {},
): DetailItem {
  return {
    // id must be first so overrides can replace it if needed
    id: base.id || undefined,
    provider: base.provider || "unknown",
    model: base.model || "unknown",
    connectionId: base.connectionId || undefined,
    timestamp: new Date().toISOString(),
    latency: base.latency || { ttft: 0, total: 0 },
    tokens: base.tokens || { prompt_tokens: 0, completion_tokens: 0 },
    request: base.request,
    providerRequest: base.providerRequest || null,
    providerResponse: base.providerResponse || null,
    response: base.response || {},
    status: base.status || "success",
    ...overrides,
  } as DetailItem;
}

export function saveUsageStats({
  provider,
  model,
  tokens,
  connectionId,
  apiKey,
  endpoint,
  label = "USAGE",
}: SaveUsageStatsParams) {
  if (!tokens || typeof tokens !== "object") return;

  const inTokens = tokens.input_tokens ?? tokens.prompt_tokens ?? 0;
  const outTokens = tokens.output_tokens ?? tokens.completion_tokens ?? 0;

  if (inTokens === 0 && outTokens === 0) return;

  const time = new Date().toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  console.log(
    `${COLORS.green}[${time}] 📊 [${label}] ${(provider || "unknown").toUpperCase()} | in=${inTokens} | out=${outTokens}${COLORS.reset}`,
  );

  // Normalize to OpenAI token shape for storage
  const normalized = {
    prompt_tokens: tokens.prompt_tokens ?? tokens.input_tokens ?? 0,
    completion_tokens: tokens.completion_tokens ?? tokens.output_tokens ?? 0,
  };

  saveRequestUsage({
    provider: provider || "unknown",
    model: model || "unknown",
    tokens: normalized,
    timestamp: new Date().toISOString(),
    connectionId: connectionId || undefined,
    apiKey: apiKey || undefined,
    endpoint: endpoint || undefined,
  }).catch(() => {
    // Best-effort usage persistence; never fail response handling on metrics writes.
  });
}
