import { describe, it, expect } from "vitest";
import { readBodyText } from "@/lib/parseJsonBody";

describe("readBodyText — abort handling", () => {
  it('returns { ok: false, reason: "aborted" } when Request throws DOMException(AbortError)', async () => {
    const req = {
      text: async () => {
        const e = new Error("aborted");
        e.name = "AbortError";
        throw e;
      },
    } as unknown as Request;
    const result = await readBodyText(req, { maxBytes: 1024 });
    expect(result).toEqual({ ok: false, reason: "aborted" });
  });

  it('returns { ok: false, reason: "aborted" } when error message contains "aborted" (lowercase)', async () => {
    const req = {
      text: async () => {
        throw new Error("request aborted by client");
      },
    } as unknown as Request;
    const result = await readBodyText(req, { maxBytes: 1024 });
    expect(result).toEqual({ ok: false, reason: "aborted" });
  });

  it("rethrows non-abort errors (does not swallow them)", async () => {
    const req = {
      text: async () => {
        throw new Error("disk full");
      },
    } as unknown as Request;
    await expect(readBodyText(req, { maxBytes: 1024 })).rejects.toThrow("disk full");
  });

  it('returns { ok: false, reason: "too_large", maxBytes } when text exceeds cap', async () => {
    const bigText = "x".repeat(2048);
    const req = { text: async () => bigText } as unknown as Request;
    const result = await readBodyText(req, { maxBytes: 1024 });
    expect(result).toEqual({ ok: false, reason: "too_large", maxBytes: 1024 });
  });

  it("returns { ok: true, text } for normal body under cap", async () => {
    const req = { text: async () => '{"hello":"world"}' } as unknown as Request;
    const result = await readBodyText(req, { maxBytes: 1024 });
    expect(result).toEqual({ ok: true, text: '{"hello":"world"}' });
  });

  it('returns { ok: true, text: "" } for empty body (not aborted, not too_large)', async () => {
    const req = { text: async () => "" } as unknown as Request;
    const result = await readBodyText(req, { maxBytes: 1024 });
    expect(result).toEqual({ ok: true, text: "" });
  });

  it("allows body exactly at the cap (boundary)", async () => {
    const exactText = "x".repeat(1024);
    const req = { text: async () => exactText } as unknown as Request;
    const result = await readBodyText(req, { maxBytes: 1024 });
    expect(result).toEqual({ ok: true, text: exactText });
  });
});
