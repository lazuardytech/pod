import { DEFAULT_MAX_TOKENS, DEFAULT_MIN_TOKENS } from "../../config/runtimeConfig.ts";

type TokenBody = {
  max_tokens?: number;
  max_completion_tokens?: number;
  tools?: unknown[];
  thinking?: { budget_tokens?: number };
};

/**
 * Adjust max_tokens based on request context
 * @param {object} body - Request body
 * @returns {number} Adjusted max_tokens
 */
export function adjustMaxTokens(body: unknown) {
  const b = (body ?? {}) as TokenBody;
  let maxTokens = b.max_tokens || b.max_completion_tokens || DEFAULT_MAX_TOKENS;

  // Auto-increase for tool calling to prevent truncated arguments
  if (b.tools && Array.isArray(b.tools) && b.tools.length > 0) {
    if (maxTokens < DEFAULT_MIN_TOKENS) {
      maxTokens = DEFAULT_MIN_TOKENS;
    }
  }

  // Ensure max_tokens > thinking.budget_tokens (Claude API requirement)
  // Claude API requires strictly greater, so add buffer instead of using DEFAULT_MAX_TOKENS
  // which could equal budget_tokens when budget_tokens >= 64000
  if (b.thinking?.budget_tokens && maxTokens <= b.thinking.budget_tokens) {
    maxTokens = b.thinking.budget_tokens + 1024;
  }

  return maxTokens;
}
