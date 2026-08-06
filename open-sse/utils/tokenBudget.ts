const DEFAULT_REASONING_HEADROOM_TOKENS = 4096;

function configuredMinimum() {
  const raw = Number(process.env.MIN_UPSTREAM_REASONING_TOKENS || "");
  if (Number.isFinite(raw) && raw > 0) return Math.floor(raw);
  return DEFAULT_REASONING_HEADROOM_TOKENS;
}

function shouldReserveReasoningBudget(provider: any, targetFormat: any) {
  return (
    targetFormat === "openai" &&
    typeof provider === "string" &&
    provider.startsWith("openai-compatible-")
  );
}

function raiseTokenField(body: any, field: any, minimum: any, log: any, provider: any, model: any) {
  const value = body[field];
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value >= minimum)
    return;

  body[field] = minimum;
  log?.debug?.(
    "PARAMS",
    `Raised ${field} from ${value} to ${minimum} for ${provider}/${model} to avoid reasoning truncation`,
  );
}

export function reserveReasoningTokenBudget(
  body: any,
  { provider, model, targetFormat, log }: any = {},
) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;
  if (!shouldReserveReasoningBudget(provider, targetFormat)) return body;

  const minimum = configuredMinimum();
  raiseTokenField(body, "max_tokens", minimum, log, provider, model);
  raiseTokenField(body, "max_completion_tokens", minimum, log, provider, model);
  return body;
}
