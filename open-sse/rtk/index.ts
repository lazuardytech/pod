// RTK port: compress tool_result content in LLM request bodies
// Injected at the top of translateRequest (before any format translation)

import { safeApply, type RtkFilterFn } from "./applyFilter.js";
import { autoDetectFilter } from "./autodetect.js";
import { MIN_COMPRESS_SIZE, RAW_CAP } from "./constants.js";

type JsonRecord = Record<string, unknown>;

type ContentPart = {
  type?: string;
  text?: string;
  [key: string]: unknown;
};

type ToolResultBlock = {
  type?: string;
  is_error?: boolean;
  content?: string | ContentPart[];
  [key: string]: unknown;
};

type CompressMessage = {
  type?: string;
  role?: string;
  content?: string | ToolResultBlock[];
  output?: string | ContentPart[];
  [key: string]: unknown;
};

export type RtkHit = {
  shape: string;
  filter: string;
  saved: number;
};

export type RtkStats = {
  bytesBefore: number;
  bytesAfter: number;
  hits: RtkHit[];
};

// Compress tool_result content in-place. Returns stats or null if disabled/failed.
export function compressMessages(
  body: JsonRecord | null | undefined,
  enabled: unknown,
): RtkStats | null {
  if (!enabled) return null;
  if (!body) return null;
  // Support both OpenAI/Claude "messages" and OpenAI Responses "input"
  const items = Array.isArray(body.messages)
    ? (body.messages as CompressMessage[])
    : Array.isArray(body.input)
      ? (body.input as CompressMessage[])
      : null;
  if (!items) return null;

  const stats: RtkStats = { bytesBefore: 0, bytesAfter: 0, hits: [] };
  try {
    for (let i = 0; i < items.length; i++) {
      const msg = items[i];
      if (!msg) continue;

      // Shape 4: OpenAI Responses — top-level { type:"function_call_output", output: string | [{type:"input_text", text}] }
      if (msg.type === "function_call_output") {
        if (typeof msg.output === "string") {
          msg.output = compressText(msg.output, stats, "openai-responses-string");
        } else if (Array.isArray(msg.output)) {
          for (let k = 0; k < msg.output.length; k++) {
            const part = msg.output[k];
            if (part && part.type === "input_text" && typeof part.text === "string") {
              part.text = compressText(part.text, stats, "openai-responses-array");
            }
          }
        }
        continue;
      }

      // Shape 1: OpenAI tool message — { role:"tool", content: "string" }
      if (msg.role === "tool" && typeof msg.content === "string") {
        msg.content = compressText(msg.content, stats, "openai-tool");
        continue;
      }

      if (!Array.isArray(msg.content)) continue;

      // Shape 1b: OpenAI tool message — { role:"tool", content:[{type:"text", text:"..."}] }
      if (msg.role === "tool") {
        for (let k = 0; k < msg.content.length; k++) {
          const part = msg.content[k] as ContentPart;
          if (part && part.type === "text" && typeof part.text === "string") {
            part.text = compressText(part.text, stats, "openai-tool-array");
          }
        }
        continue;
      }

      // Shape 2/3: blocks array with tool_result entries
      for (let j = 0; j < msg.content.length; j++) {
        const block = msg.content[j];
        if (!block || block.type !== "tool_result") continue;
        if (block.is_error === true) continue; // preserve error traces

        if (typeof block.content === "string") {
          // Shape 2: claude string form
          block.content = compressText(block.content, stats, "claude-string");
        } else if (Array.isArray(block.content)) {
          // Shape 3: claude array form — compress each text part
          for (let k = 0; k < block.content.length; k++) {
            const part = block.content[k];
            if (part && part.type === "text" && typeof part.text === "string") {
              part.text = compressText(part.text, stats, "claude-array");
            }
          }
        }
      }
    }
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    console.warn("[RTK] compressMessages error:", message);
    return null;
  }
  return stats;
}

function compressText(text: string, stats: RtkStats, shape: string): string {
  const bytesIn = text.length;
  stats.bytesBefore += bytesIn;

  if (bytesIn < MIN_COMPRESS_SIZE || bytesIn > RAW_CAP) {
    stats.bytesAfter += bytesIn;
    return text;
  }

  const fn = autoDetectFilter(text) as RtkFilterFn | null;
  if (!fn) {
    stats.bytesAfter += bytesIn;
    return text;
  }

  const out = safeApply(fn, text);

  // Safety: never return empty, never grow the input
  if (!out || out.length === 0 || out.length >= bytesIn) {
    stats.bytesAfter += bytesIn;
    return text;
  }

  stats.bytesAfter += out.length;
  stats.hits.push({
    shape,
    filter: fn.filterName || fn.name || "anonymous",
    saved: bytesIn - out.length,
  });
  return out;
}

// Convenience: format a log line from stats
export function formatRtkLog(stats: RtkStats | null | undefined): string | null {
  if (!stats || !stats.hits || stats.hits.length === 0) return null;
  const saved = stats.bytesBefore - stats.bytesAfter;
  const pct = stats.bytesBefore > 0 ? ((saved / stats.bytesBefore) * 100).toFixed(1) : "0";
  const filters = Array.from(new Set(stats.hits.map((h: RtkHit) => h.filter))).join(",");
  return `[RTK] saved ${saved}B / ${stats.bytesBefore}B (${pct}%) via [${filters}] hits=${stats.hits.length}`;
}
