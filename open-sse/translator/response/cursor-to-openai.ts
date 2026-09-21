/**
 * Cursor to OpenAI Response Translator
 * CursorExecutor already emits OpenAI format - this is a passthrough
 */

import { FORMATS } from "../formats.ts";
import { register } from "../registry.ts";

/** OpenAI-shaped fields this passthrough inspects on executor output. */
interface CursorOpenAIChunk {
  object?: string;
  choices?: unknown[];
}

/**
 * Convert Cursor response to OpenAI format
 * Since CursorExecutor.transformProtobufToSSE/JSON already emits OpenAI chunks,
 * this is a passthrough translator (similar to Kiro pattern)
 */
export function convertCursorToOpenAI(chunk: unknown, _state: unknown) {
  if (!chunk) return null;

  const c = chunk as CursorOpenAIChunk;

  // If chunk is already in OpenAI format (from executor transform), return as-is
  if (c.object === "chat.completion.chunk" && c.choices) {
    return chunk;
  }

  // If chunk is a completion object (non-streaming), return as-is
  if (c.object === "chat.completion" && c.choices) {
    return chunk;
  }

  // Fallback: return chunk as-is (should not reach here)
  return chunk;
}

register(FORMATS.CURSOR, FORMATS.OPENAI, null, convertCursorToOpenAI);
