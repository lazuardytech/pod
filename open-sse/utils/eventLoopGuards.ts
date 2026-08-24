/** Event-loop guards for large chat bodies. Pure helpers — safe to unit-test. */

export const MAX_REQUEST_BYTES_FOR_RTK = 512 * 1024;
export const HEAVY_SSE_BODY_BYTES = 256 * 1024;
export const MAX_HEAVY_SSE_CONNECTIONS = 4;

export function estimateRequestMessageBytes(messages: unknown): number {
  if (!Array.isArray(messages)) return 0;
  let sum = 0;
  for (const message of messages) {
    if (!message || typeof message !== "object") {
      sum += 256;
      continue;
    }
    const content = (message as { content?: unknown }).content;
    if (typeof content === "string") {
      sum += content.length;
      continue;
    }
    if (Array.isArray(content)) {
      for (const part of content) {
        if (part && typeof part === "object") {
          const record = part as { text?: unknown; content?: unknown };
          if (typeof record.text === "string") sum += record.text.length;
          else if (typeof record.content === "string") sum += record.content.length;
          else sum += 256;
        } else {
          sum += 256;
        }
      }
      continue;
    }
    sum += 256;
  }
  return sum;
}

export function isRequestTooLargeForRtk(
  bytes: number,
  limit: number = MAX_REQUEST_BYTES_FOR_RTK,
): boolean {
  return bytes > limit;
}

export function isHeavySseBody(byteLength: number, limit: number = HEAVY_SSE_BODY_BYTES): boolean {
  return byteLength >= limit;
}

export function passthroughNeedsJsonParse(
  line: string,
  opts: { includeUsage: boolean; hasToolNameMap: boolean },
): boolean {
  if (opts.includeUsage || opts.hasToolNameMap) return true;
  return (
    line.includes("tool_use") ||
    line.includes("reasoning_summary") ||
    line.includes("prompt_filter_results") ||
    line.includes("content_filter_results") ||
    line.includes('"usage"') ||
    line.includes('"error"')
  );
}
