import { describe, expect, it } from "vitest";
import {
  estimateRequestMessageBytes,
  HEAVY_SSE_BODY_BYTES,
  isHeavySseBody,
  isRequestTooLargeForRtk,
  MAX_REQUEST_BYTES_FOR_RTK,
  passthroughNeedsJsonParse,
} from "../../open-sse/utils/eventLoopGuards.ts";
import { USAGE_HISTORY_MAX_DAYS } from "../../src/lib/usageDb.ts";

describe("estimateRequestMessageBytes", () => {
  it("returns 0 for non-arrays", () => {
    expect(estimateRequestMessageBytes(null)).toBe(0);
    expect(estimateRequestMessageBytes("nope")).toBe(0);
  });

  it("sums string message content", () => {
    expect(
      estimateRequestMessageBytes([
        { role: "user", content: "hello" },
        { role: "assistant", content: "world" },
      ]),
    ).toBe(10);
  });

  it("sums multipart text parts", () => {
    expect(
      estimateRequestMessageBytes([
        {
          role: "user",
          content: [
            { type: "text", text: "ab" },
            { type: "text", text: "cd" },
          ],
        },
      ]),
    ).toBe(4);
  });

  it("counts unknown parts as 256 bytes", () => {
    expect(estimateRequestMessageBytes([{ role: "user", content: [{ type: "image" }] }])).toBe(256);
  });
});

describe("isRequestTooLargeForRtk", () => {
  it("is false at the 512KiB boundary", () => {
    expect(isRequestTooLargeForRtk(MAX_REQUEST_BYTES_FOR_RTK)).toBe(false);
  });

  it("is true one byte over 512KiB", () => {
    expect(isRequestTooLargeForRtk(MAX_REQUEST_BYTES_FOR_RTK + 1)).toBe(true);
  });
});

describe("passthroughNeedsJsonParse", () => {
  const clean = `data: {"id":"chatcmpl-1","choices":[{"delta":{"content":"hi"}}]}`;

  it("skips parse on a clean OpenAI data line", () => {
    expect(passthroughNeedsJsonParse(clean, { includeUsage: false, hasToolNameMap: false })).toBe(
      false,
    );
  });

  it("parses when includeUsage is set", () => {
    expect(passthroughNeedsJsonParse(clean, { includeUsage: true, hasToolNameMap: false })).toBe(
      true,
    );
  });

  it("parses when a tool name map is present", () => {
    expect(passthroughNeedsJsonParse(clean, { includeUsage: false, hasToolNameMap: true })).toBe(
      true,
    );
  });

  it("parses tool_use, reasoning_summary, Azure filters, usage, and error", () => {
    expect(
      passthroughNeedsJsonParse(`data: {"type":"tool_use"}`, {
        includeUsage: false,
        hasToolNameMap: false,
      }),
    ).toBe(true);
    expect(
      passthroughNeedsJsonParse(`data: {"reasoning_summary":[]}`, {
        includeUsage: false,
        hasToolNameMap: false,
      }),
    ).toBe(true);
    expect(
      passthroughNeedsJsonParse(`data: {"prompt_filter_results":[]}`, {
        includeUsage: false,
        hasToolNameMap: false,
      }),
    ).toBe(true);
    expect(
      passthroughNeedsJsonParse(`data: {"usage":{"prompt_tokens":1}}`, {
        includeUsage: false,
        hasToolNameMap: false,
      }),
    ).toBe(true);
    expect(
      passthroughNeedsJsonParse(`data: {"error":{"message":"nope"}}`, {
        includeUsage: false,
        hasToolNameMap: false,
      }),
    ).toBe(true);
  });
});

describe("isHeavySseBody", () => {
  it("is false just under 256KiB", () => {
    expect(isHeavySseBody(HEAVY_SSE_BODY_BYTES - 1)).toBe(false);
  });

  it("is true at 256KiB", () => {
    expect(isHeavySseBody(HEAVY_SSE_BODY_BYTES)).toBe(true);
  });
});

describe("usage history retention", () => {
  it("trims at 30 days", () => {
    expect(USAGE_HISTORY_MAX_DAYS).toBe(30);
  });
});
