import pkg from "../../../package.json" with { type: "json" };

export const APP_CONFIG = {
  name: "Pod",
  description: "AI Infrastructure Management",
  version: pkg.version,
  displayVersion: "0.0.81",
} as const;

export const MAX_REQUEST_BODY_BYTES: number = (() => {
  const raw = process.env.POD_MAX_REQUEST_BODY_BYTES;
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 50 * 1024 * 1024; // 50MB default
})();

export const MAX_CHAT_BODY_BYTES: number = (() => {
  const raw = process.env.POD_MAX_CHAT_BODY_BYTES;
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : MAX_REQUEST_BODY_BYTES;
})();

export function getMaxRequestBodyBytes(stream: boolean): number {
  return stream ? MAX_CHAT_BODY_BYTES : MAX_REQUEST_BODY_BYTES;
}

export const GITHUB_CONFIG = {
  changelogUrl: "https://raw.githubusercontent.com/lazuardytech/pod/refs/heads/master/CHANGELOG.md",
} as const;

export const THEME_CONFIG = {
  storageKey: "theme",
  defaultTheme: "dark", // "light" | "dark" | "system"
} as const;

export const SUBSCRIPTION_CONFIG = {
  price: 1.0,
  currency: "USD",
  interval: "month",
  planName: "Pro Plan",
} as const;

export const API_ENDPOINTS = {
  users: "/api/users",
  providers: "/api/providers",
  payments: "/api/payments",
  auth: "/api/auth",
} as const;

export const CONSOLE_LOG_CONFIG = {
  maxLines: 200,
  pollIntervalMs: 1000,
} as const;

// Provider API endpoints (for display only)
export const PROVIDER_ENDPOINTS: Record<string, string> = {
  openrouter: "https://openrouter.ai/api/v1/chat/completions",
  glm: "https://api.z.ai/api/anthropic/v1/messages",
  "glm-cn": "https://open.bigmodel.cn/api/coding/paas/v4/chat/completions",
  kimi: "https://api.kimi.com/coding/v1/messages",
  minimax: "https://api.minimax.io/anthropic/v1/messages",
  "minimax-cn": "https://api.minimaxi.com/anthropic/v1/messages",
  alicode: "https://coding.dashscope.aliyuncs.com/v1/chat/completions",
  "alicode-intl": "https://coding-intl.dashscope.aliyuncs.com/v1/chat/completions",
  "volcengine-ark": "https://ark.cn-beijing.volces.com/api/coding/v3/chat/completions",
  byteplus: "https://ark.ap-southeast.bytepluses.com/api/coding/v3/chat/completions",
  openai: "https://api.openai.com/v1/chat/completions",
  anthropic: "https://api.anthropic.com/v1/messages",
  gemini: "https://generativelanguage.googleapis.com/v1beta/models",
  ollama: "https://ollama.com/api/chat",
  "ollama-local": "http://localhost:11434/api/chat",
};

// Re-export from models.ts for backward compatibility
export { AI_MODELS, PROVIDER_MODELS } from "./models";
// Re-export from providers.ts for backward compatibility
export {
  AI_PROVIDERS,
  APIKEY_PROVIDERS,
  AUTH_METHODS,
  FREE_PROVIDERS,
  OAUTH_PROVIDERS,
  WEB_COOKIE_PROVIDERS,
} from "./providers";
