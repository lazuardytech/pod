const LOG_LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 } as const;
type LogLevel = (typeof LOG_LEVELS)[keyof typeof LOG_LEVELS];
const LEVEL: LogLevel = (() => {
  const env = (process.env.LOG_LEVEL || "").toLowerCase();
  if (env === "debug") return LOG_LEVELS.DEBUG;
  if (env === "info") return LOG_LEVELS.INFO;
  if (env === "warn") return LOG_LEVELS.WARN;
  if (env === "error") return LOG_LEVELS.ERROR;
  return LOG_LEVELS.INFO;
})();
function formatTime(): string {
  return new Date().toLocaleTimeString("en-US", { hour12: false });
}
const SENSITIVE_KEY_RE =
  /(api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|bearer|authorization|cookie|secret|password|client[_-]?secret|private[_-]?key|sa[_-]?json|service[_-]?account)/i;
const TOKEN_VALUE_RE = new RegExp(
  "(Bearer\\s+[A-Za-z0-9._\\-+/=]{16,}|sk-[A-Za-z0-9._\\-]{16,}|eyJ[A-Za-z0-9._\\-]{16,})",
  "g",
);
function maskValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value !== "string") return value;
  if (value.length < 8) return "***";
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}
function redactString(str: string): string {
  return str.replace(TOKEN_VALUE_RE, (match) => maskValue(match) as string);
}
function sanitizeForLog(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (depth > 4) return "[depth-limit]";
  if (typeof value === "string") return redactString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map((v) => sanitizeForLog(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (SENSITIVE_KEY_RE.test(k)) out[k] = typeof v === "string" ? maskValue(v) : "[redacted]";
      else out[k] = sanitizeForLog(v, depth + 1);
    }
    return out;
  }
  return String(value);
}
function formatData(data: unknown): string {
  if (!data) return "";
  if (typeof data === "string") return redactString(data);
  try {
    return JSON.stringify(sanitizeForLog(data));
  } catch {
    return String(data);
  }
}
export function debug(tag: string, message: string, data?: unknown): void {
  if (LEVEL <= LOG_LEVELS.DEBUG) {
    const dataStr = data ? ` ${formatData(data)}` : "";
    console.log(`[${formatTime()}] 🔍 [${tag}] ${redactString(message)}${dataStr}`);
  }
}
export function info(tag: string, message: string, data?: unknown): void {
  if (LEVEL <= LOG_LEVELS.INFO) {
    const dataStr = data ? ` ${formatData(data)}` : "";
    console.log(`[${formatTime()}] ℹ️  [${tag}] ${redactString(message)}${dataStr}`);
  }
}
export function warn(tag: string, message: string, data?: unknown): void {
  if (LEVEL <= LOG_LEVELS.WARN) {
    const _dataStr = data ? ` ${formatData(data)}` : "";
  }
}
export function error(tag: string, message: string, data?: unknown): void {
  if (LEVEL <= LOG_LEVELS.ERROR) {
    const dataStr = data ? ` ${formatData(data)}` : "";
    console.log(`[${formatTime()}] ❌ [${tag}] ${redactString(message)}${dataStr}`);
  }
}
export function request(method: string, path: string, extra?: unknown): void {
  const dataStr = extra ? ` ${formatData(extra)}` : "";
  console.log(`\x1b[36m[${formatTime()}] 📥 ${method} ${redactString(path)}${dataStr}\x1b[0m`);
}
export function response(status: number, duration: number, extra?: unknown): void {
  const icon = status < 400 ? "📤" : "💥";
  const dataStr = extra ? ` ${formatData(extra)}` : "";
  console.log(`[${formatTime()}] ${icon} ${status} (${duration}ms)${dataStr}`);
}
export function stream(event: string, data?: unknown): void {
  const dataStr = data ? ` ${formatData(data)}` : "";
  console.log(`[${formatTime()}] 🌊 [STREAM] ${redactString(event)}${dataStr}`);
}
export function maskKey(key: string | null | undefined): string {
  if (!key || key.length < 8) return "***";
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}
export { sanitizeForLog };
