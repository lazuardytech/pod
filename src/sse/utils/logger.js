// Logger utility for cloud
//
// Security: all log output is passed through sanitizeForLog() at the sink.
// This is defense-in-depth on top of call-site masking via maskKey().
// Even if a caller forgets to mask, sensitive fields will be redacted here.

const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

// Configurable log level (default: INFO; set LOG_LEVEL=debug for verbose dev mode).
const LEVEL = (() => {
  const env = (process.env.LOG_LEVEL || "").toLowerCase();
  if (env === "debug") return LOG_LEVELS.DEBUG;
  if (env === "info") return LOG_LEVELS.INFO;
  if (env === "warn") return LOG_LEVELS.WARN;
  if (env === "error") return LOG_LEVELS.ERROR;
  return LOG_LEVELS.INFO;
})();

function formatTime() {
  return new Date().toLocaleTimeString("en-US", { hour12: false });
}

// Field-name patterns that always indicate sensitive values.
// Match is case-insensitive against the full key name.
const SENSITIVE_KEY_RE =
  /(api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|bearer|authorization|cookie|secret|password|client[_-]?secret|private[_-]?key|sa[_-]?json|service[_-]?account)/i;

// Token-shape patterns inside string values (Bearer, sk-..., long opaque hex/base64).
// Conservative — only matches values that almost certainly carry a credential.
const TOKEN_VALUE_RE = /(Bearer\s+[A-Za-z0-9._\-+/=]{16,}|sk-[A-Za-z0-9._\-]{16,}|eyJ[A-Za-z0-9._\-]{20,})/g;

function maskValue(value) {
  if (value == null) return value;
  if (typeof value !== "string") return value;
  if (value.length < 8) return "***";
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function redactString(str) {
  if (typeof str !== "string") return str;
  return str.replace(TOKEN_VALUE_RE, (match) => maskValue(match));
}

function sanitizeForLog(value, depth = 0) {
  if (value == null) return value;
  if (depth > 4) return "[depth-limit]";

  if (typeof value === "string") return redactString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();

  if (Array.isArray(value)) {
    return value.map((v) => sanitizeForLog(v, depth + 1));
  }

  if (typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (SENSITIVE_KEY_RE.test(k)) {
        out[k] = typeof v === "string" ? maskValue(v) : "[redacted]";
      } else {
        out[k] = sanitizeForLog(v, depth + 1);
      }
    }
    return out;
  }

  return String(value);
}

function formatData(data) {
  if (!data) return "";
  if (typeof data === "string") return redactString(data);
  try {
    return JSON.stringify(sanitizeForLog(data));
  } catch {
    return String(data);
  }
}

export function debug(tag, message, data) {
  if (LEVEL <= LOG_LEVELS.DEBUG) {
    const dataStr = data ? ` ${formatData(data)}` : "";
    console.log(`[${formatTime()}] 🔍 [${tag}] ${redactString(message)}${dataStr}`);
  }
}

export function info(tag, message, data) {
  if (LEVEL <= LOG_LEVELS.INFO) {
    const dataStr = data ? ` ${formatData(data)}` : "";
    console.log(`[${formatTime()}] ℹ️  [${tag}] ${redactString(message)}${dataStr}`);
  }
}

export function warn(tag, message, data) {
  if (LEVEL <= LOG_LEVELS.WARN) {
    const _dataStr = data ? ` ${formatData(data)}` : "";
    // console.warn(`[${formatTime()}] ⚠️  [${tag}] ${redactString(message)}${_dataStr}`);
  }
}

export function error(tag, message, data) {
  if (LEVEL <= LOG_LEVELS.ERROR) {
    const dataStr = data ? ` ${formatData(data)}` : "";
    console.log(`[${formatTime()}] ❌ [${tag}] ${redactString(message)}${dataStr}`);
  }
}

export function request(method, path, extra) {
  const dataStr = extra ? ` ${formatData(extra)}` : "";
  console.log(`\x1b[36m[${formatTime()}] 📥 ${method} ${redactString(path)}${dataStr}\x1b[0m`);
}

export function response(status, duration, extra) {
  const icon = status < 400 ? "📤" : "💥";
  const dataStr = extra ? ` ${formatData(extra)}` : "";
  console.log(`[${formatTime()}] ${icon} ${status} (${duration}ms)${dataStr}`);
}

export function stream(event, data) {
  const dataStr = data ? ` ${formatData(data)}` : "";
  console.log(`[${formatTime()}] 🌊 [STREAM] ${redactString(event)}${dataStr}`);
}

// Mask sensitive data — kept for backward compatibility with callers.
// New code should rely on the automatic sink-level sanitizer above; this
// helper still provides convenient inline display for messages like
// `API Key: ${maskKey(apiKey)}`.
export function maskKey(key) {
  if (!key || key.length < 8) return "***";
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

// Exported for tests and downstream callers that want to pre-sanitize.
export { sanitizeForLog };
