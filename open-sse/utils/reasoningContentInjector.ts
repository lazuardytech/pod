// Some thinking-mode providers (DeepSeek, Kimi, ...) require reasoning_content
// to be echoed back on assistant messages. Clients in OpenAI format don't send it,
// so we inject a non-empty placeholder to satisfy upstream validation.

const PLACEHOLDER = " ";

const DEEPSEEK_V4_PRO = "deepseek-v4-pro";
const DEEPSEEK_V4_PRO_ALIASES = {
  [`${DEEPSEEK_V4_PRO}-max`]: {
    thinkingType: "enabled",
    reasoningEffort: "max",
  },
  [`${DEEPSEEK_V4_PRO}-none`]: {
    thinkingType: "disabled",
    reasoningEffort: null,
  },
};

// Provider-level rules: keyed by executor.provider
const PROVIDER_RULES = {
  deepseek: { scope: "all" },
};

// Model-level rules: matched by predicate against model id
const MODEL_RULES = [
  { match: (m: any) => m?.startsWith?.("kimi-"), scope: "toolCalls" },
  { match: (m: any) => m?.startsWith?.("deepseek-"), scope: "all" },
];

function shouldInject(message: any, scope: any) {
  if (message?.role !== "assistant") return false;
  const rc = message.reasoning_content;
  if (typeof rc === "string" && rc.length > 0) return false;
  if (scope === "toolCalls")
    return Array.isArray(message.tool_calls) && message.tool_calls.length > 0;
  return true;
}

function applyDeepSeekV4ProAlias({ provider, model, body }: any) {
  const alias = DEEPSEEK_V4_PRO_ALIASES[model];
  if (provider !== "deepseek" || !alias || !body) return body;

  const nextBody = {
    ...body,
    model: DEEPSEEK_V4_PRO,
    extra_body: {
      ...(body.extra_body || {}),
      thinking: {
        ...(body.extra_body?.thinking || {}),
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

function applyRule(body: any, rule: any) {
  if (!rule || !body?.messages) return body;
  const messages = body.messages.map((m: any) =>
    shouldInject(m, rule.scope) ? { ...m, reasoning_content: PLACEHOLDER } : m,
  );
  return { ...body, messages };
}

export function injectReasoningContent({ provider, model, body }: any) {
  const providerRule = PROVIDER_RULES[provider];
  const modelRule = MODEL_RULES.find((r: any) => r.match(model));
  const rule = providerRule || modelRule;
  const nextBody = applyDeepSeekV4ProAlias({ provider, model, body });
  return applyRule(nextBody, rule);
}

export { applyDeepSeekV4ProAlias };
