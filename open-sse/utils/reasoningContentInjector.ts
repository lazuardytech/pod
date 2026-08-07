// Some thinking-mode providers (DeepSeek, Kimi, ...) require reasoning_content
// to be echoed back on assistant messages. Clients in OpenAI format don't send it,
// so we inject a non-empty placeholder to satisfy upstream validation.

const PLACEHOLDER = " ";

const DEEPSEEK_V4_PRO = "deepseek-v4-pro";

type AliasConfig = {
  thinkingType: string;
  reasoningEffort: string | null;
};

const DEEPSEEK_V4_PRO_ALIASES: Record<string, AliasConfig> = {
  [`${DEEPSEEK_V4_PRO}-max`]: {
    thinkingType: "enabled",
    reasoningEffort: "max",
  },
  [`${DEEPSEEK_V4_PRO}-none`]: {
    thinkingType: "disabled",
    reasoningEffort: null,
  },
};

type InjectScope = "all" | "toolCalls";

type InjectRule = { scope: InjectScope };

// Provider-level rules: keyed by executor.provider
const PROVIDER_RULES: Record<string, InjectRule> = {
  deepseek: { scope: "all" },
};

// Model-level rules: matched by predicate against model id
const MODEL_RULES: Array<{ match: (m: string | undefined) => boolean; scope: InjectScope }> = [
  { match: (m) => Boolean(m?.startsWith?.("kimi-")), scope: "toolCalls" },
  { match: (m) => Boolean(m?.startsWith?.("deepseek-")), scope: "all" },
];

type ChatMessage = {
  role?: string;
  reasoning_content?: unknown;
  tool_calls?: unknown[];
  [key: string]: unknown;
};

type InjectBody = {
  messages?: ChatMessage[];
  model?: string;
  extra_body?: {
    thinking?: Record<string, unknown>;
    [key: string]: unknown;
  };
  reasoning_effort?: unknown;
  [key: string]: unknown;
};

type InjectArgs = {
  provider?: string;
  model?: string;
  body?: unknown;
};

function shouldInject(message: ChatMessage | null | undefined, scope: InjectScope) {
  if (message?.role !== "assistant") return false;
  const rc = message.reasoning_content;
  if (typeof rc === "string" && rc.length > 0) return false;
  if (scope === "toolCalls")
    return Array.isArray(message.tool_calls) && message.tool_calls.length > 0;
  return true;
}

function applyDeepSeekV4ProAlias({ provider, model, body }: InjectArgs) {
  const bodyRecord = body as InjectBody | null | undefined;
  const alias = model ? DEEPSEEK_V4_PRO_ALIASES[model] : undefined;
  if (provider !== "deepseek" || !alias || !bodyRecord) return bodyRecord;

  const nextBody: InjectBody = {
    ...bodyRecord,
    model: DEEPSEEK_V4_PRO,
    extra_body: {
      ...(bodyRecord.extra_body || {}),
      thinking: {
        ...(bodyRecord.extra_body?.thinking || {}),
        type: alias.thinkingType,
      },
    },
  };

  if (alias.reasoningEffort) {
    nextBody.reasoning_effort = alias.reasoningEffort;
  } else {
    delete nextBody.reasoning_effort;
  }

  return nextBody;
}

function applyRule(body: InjectBody | null | undefined, rule: InjectRule | undefined) {
  if (!rule || !body?.messages) return body;
  const messages = body.messages.map((m: ChatMessage) =>
    shouldInject(m, rule.scope) ? { ...m, reasoning_content: PLACEHOLDER } : m,
  );
  return { ...body, messages };
}

export function injectReasoningContent({ provider, model, body }: InjectArgs) {
  const providerRule = provider ? PROVIDER_RULES[provider] : undefined;
  const modelRule = MODEL_RULES.find((r) => r.match(model));
  const rule = providerRule || modelRule;
  const nextBody = applyDeepSeekV4ProAlias({ provider, model, body });
  return applyRule(nextBody, rule);
}

export { applyDeepSeekV4ProAlias };
