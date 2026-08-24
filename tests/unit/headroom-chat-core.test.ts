import { afterEach, describe, expect, it, vi } from "vitest";
import { isTokenSaverEnabled, TOKEN_SAVER_HEADER } from "../../open-sse/config/runtimeConfig.ts";
import {
  compressWithHeadroom,
  isAllowedHeadroomUrl,
  type HeadroomDiagnostics,
} from "../../open-sse/rtk/headroom.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("isTokenSaverEnabled", () => {
  it("is on by default", () => {
    expect(isTokenSaverEnabled()).toBe(true);
    expect(isTokenSaverEnabled({})).toBe(true);
  });

  it("turns off when X-Pod-Token-Saver is off (any case)", () => {
    expect(isTokenSaverEnabled({ [TOKEN_SAVER_HEADER]: "off" })).toBe(false);
    expect(isTokenSaverEnabled({ "X-Pod-Token-Saver": "OFF" })).toBe(false);
  });
});

describe("compressWithHeadroom fail-open", () => {
  it("keeps original messages when the proxy is unreachable", async () => {
    const messages = [{ role: "user", content: "keep me" }];
    const body = { messages: messages.map((m) => ({ ...m })) };
    const before = JSON.stringify(body.messages);
    globalThis.fetch = vi.fn(async () => {
      throw Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:8787"), {
        code: "ECONNREFUSED",
      });
    }) as unknown as typeof fetch;

    const diagnostics: HeadroomDiagnostics = {};
    const result = await compressWithHeadroom(body, {
      enabled: true,
      url: "http://localhost:8787",
      model: "gpt-4o",
      format: "openai",
      diagnostics,
    });

    expect(result).toBeNull();
    expect(JSON.stringify(body.messages)).toBe(before);
    expect(diagnostics.reason).toMatch(/ECONNREFUSED|request failed/i);
    expect(globalThis.fetch).toHaveBeenCalledOnce();
  });

  it("does not fetch public hosts (SSRF)", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const diagnostics: HeadroomDiagnostics = {};
    const result = await compressWithHeadroom(
      { messages: [{ role: "user", content: "x" }] },
      {
        enabled: true,
        url: "https://evil.example/v1",
        format: "openai",
        diagnostics,
      },
    );
    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(diagnostics.reason).toMatch(/blocked/i);
  });

  it("allows loopback and docker DNS hostname headroom", () => {
    expect(isAllowedHeadroomUrl("http://localhost:8787")).toBe(true);
    expect(isAllowedHeadroomUrl("http://127.0.0.1:8787")).toBe(true);
    expect(isAllowedHeadroomUrl("http://headroom:8787")).toBe(true);
    expect(isAllowedHeadroomUrl("https://169.254.169.254/")).toBe(false);
    expect(isAllowedHeadroomUrl("http://0.0.0.0:8787")).toBe(false);
  });
});
