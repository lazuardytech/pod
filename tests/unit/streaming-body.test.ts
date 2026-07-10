import { describe, it, expect } from "vitest";
import { readBodyTextStream } from "@/lib/parseJsonBody";

const encoder = new TextEncoder();

function makeRequestWithChunks(chunks: Uint8Array[]): Request {
  return {
    body: new ReadableStream({
      start(controller) {
        for (const c of chunks) controller.enqueue(c);
        controller.close();
      },
    }),
  } as unknown as Request;
}

function makeRequestWithEmptyBody(): Request {
  return {
    body: new ReadableStream({
      start(controller) {
        controller.close();
      },
    }),
  } as unknown as Request;
}

function makeRequestWithThrowingReader(getReader: () => unknown): Request {
  return {
    body: {
      getReader,
    } as unknown as ReadableStream<Uint8Array>,
  } as unknown as Request;
}

describe("readBodyTextStream — body read", () => {
  it("reads body across multiple chunks and returns full text", async () => {
    const chunks = Array.from({ length: 5 }, () => encoder.encode("a".repeat(1024)));
    const req = makeRequestWithChunks(chunks);
    const result = await readBodyTextStream(req, { maxBytes: 10000 });
    expect(result).toEqual({ ok: true, text: "a".repeat(5 * 1024) });
  });

  it("returns too_large when body exceeds maxBytes mid-stream", async () => {
    const chunks = Array.from({ length: 10 }, () => encoder.encode("b".repeat(10 * 1024)));
    const req = makeRequestWithChunks(chunks);
    const result = await readBodyTextStream(req, { maxBytes: 50 * 1024 });
    expect(result).toEqual({ ok: false, reason: "too_large", maxBytes: 50 * 1024 });
  });

  it("returns aborted when body throws an AbortError-shaped error mid-stream", async () => {
    let callCount = 0;
    const req = makeRequestWithThrowingReader(() => ({
      read: async () => {
        callCount += 1;
        if (callCount === 1) {
          return { done: false, value: encoder.encode("first") };
        }
        const e = new Error("aborted");
        e.name = "AbortError";
        throw e;
      },
      cancel: async () => {},
    }));
    const result = await readBodyTextStream(req, { maxBytes: 1024 });
    expect(result).toEqual({ ok: false, reason: "aborted" });
  });

  it('returns aborted when body throws an error with lowercase "aborted" in its message', async () => {
    let callCount = 0;
    const req = makeRequestWithThrowingReader(() => ({
      read: async () => {
        callCount += 1;
        if (callCount === 1) {
          return { done: false, value: encoder.encode("first") };
        }
        throw new Error("request aborted by client");
      },
      cancel: async () => {},
    }));
    const result = await readBodyTextStream(req, { maxBytes: 1024 });
    expect(result).toEqual({ ok: false, reason: "aborted" });
  });

  it("returns { ok: true, text: '' } for an empty body", async () => {
    const req = makeRequestWithEmptyBody();
    const result = await readBodyTextStream(req, { maxBytes: 1024 });
    expect(result).toEqual({ ok: true, text: "" });
  });
});
