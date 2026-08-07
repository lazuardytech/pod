const DEFAULT_REASONING_HEADROOM_TOKENS = 4096;

type TokenBudgetBody = Record<string, unknown>;

type TokenBudgetLog = {
  debug?: (tag: string, msg: string) => void;
};

type TokenBudgetOptions = {
  provider?: string;
  model?: string;
  targetFormat?: string;
  log?: TokenBudgetLog;
};

function configuredMinimum() {
  const raw = Number(process.env.MIN_UPSTREAM_REASONING_TOKENS || "");
  if (Number.isFinite(raw) && raw > 0) return Math.floor(raw);
  return DEFAULT_REASONING_HEADROOM_TOKENS;
}

function shouldReserveReasoningBudget(provider: unknown, targetFormat: unknown) {
  return (
    targetFormat === "openai" &&
    typeof provider === "string" &&
    provider.startsWith("openai-compatible-")
  );
}

function raiseTokenField(
  body: TokenBudgetBody,
  field: string,
  minimum: number,
  log: TokenBudgetLog | undefined,
  provider: unknown,
  model: unknown,
) {
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
  body: unknown,
  { provider, model, targetFormat, log }: TokenBudgetOptions = {},
) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;
  const bodyRecord = body as TokenBudgetBody;
  if (!shouldReserveReasoningBudget(provider, targetFormat)) return bodyRecord;

  const minimum = configuredMinimum();
  raiseTokenField(bodyRecord, "max_tokens", minimum, log, provider, model);
  raiseTokenField(bodyRecord, "max_completion_tokens", minimum, log, provider, model);
  return bodyRecord;
}
