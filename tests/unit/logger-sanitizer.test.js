/**
 * Tests for src/sse/utils/logger.js — sink-level sanitizer
 *
 * Verifies that even if a caller forgets to mask, the logger redacts:
 * - Sensitive object fields by key name (apiKey, access_token, cookie, etc.)
 * - Token-shaped values inside strings (Bearer ..., sk-..., JWT eyJ...)
 *
 * Closes CodeQL alert #39 (js/clear-text-logging) as defense-in-depth.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { debug, error, info, maskKey, sanitizeForLog } from "../../src/sse/utils/logger.js";

describe("logger sanitizer", () => {
  describe("maskKey()", () => {
    it("returns *** for short or empty values", () => {
      expect(maskKey("")).toBe("***");
      expect(maskKey(null)).toBe("***");
      expect(maskKey("short")).toBe("***");
    });
    it("masks middle of long values", () => {
      expect(maskKey("sk-abcd-very-long-key-1234")).toBe("sk-a...1234");
    });
  });

  describe("sanitizeForLog() — sensitive keys", () => {
    it("redacts apiKey", () => {
      const out = sanitizeForLog({ apiKey: "sk-abcd-very-long-token-1234" });
      expect(out.apiKey).toBe("sk-a...1234");
    });
    it("redacts access_token / refresh_token / id_token", () => {
      const out = sanitizeForLog({
        access_token: "tok-abcdefgh-very-long",
        refresh_token: "ref-abcdefgh-very-long",
        id_token: "idt-abcdefgh-very-long",
      });
      expect(out.access_token).toBe("tok-...long");
      expect(out.refresh_token).toBe("ref-...long");
      expect(out.id_token).toBe("idt-...long");
    });
    it("redacts authorization / cookie / secret / password", () => {
      const out = sanitizeForLog({
        Authorization: "Bearer abcd1234567890abcd",
        cookie: "sso=abcdef.signed.cookie.value",
        client_secret: "abcdef-very-long-secret",
        password: "p@ssw0rd-12345",
      });
      expect(out.Authorization).toBe("Bear...abcd");
      expect(out.cookie).toBe("sso=...alue");
      expect(out.client_secret).toBe("abcd...cret");
      expect(out.password).toBe("p@ss...2345");
    });
    it("redacts private_key (string) and sa_json (object)", () => {
      const out = sanitizeForLog({
        private_key: "-----BEGIN PRIVATE KEY-----\nMIIEvabcdefghijklm...",
        sa_json: { client_email: "x@y.iam.gserviceaccount.com" },
      });
      // String value of a sensitive key gets prefix...suffix mask via maskValue.
      expect(out.private_key.startsWith("----")).toBe(true);
      expect(out.private_key).not.toContain("BEGIN PRIVATE KEY");
      // Non-string value of a sensitive key becomes [redacted].
      expect(out.sa_json).toBe("[redacted]");
    });
    it("does NOT redact non-sensitive keys", () => {
      const out = sanitizeForLog({
        connectionId: "conn-123",
        providerId: "openai",
        model: "gpt-4",
        count: 42,
      });
      expect(out).toEqual({
        connectionId: "conn-123",
        providerId: "openai",
        model: "gpt-4",
        count: 42,
      });
    });
    it("recurses into nested objects", () => {
      const out = sanitizeForLog({
        provider: { id: "openai", apiKey: "sk-abcdefgh-very-long" },
      });
      expect(out.provider.apiKey).toBe("sk-a...long");
      expect(out.provider.id).toBe("openai");
    });
    it("recurses into arrays", () => {
      const out = sanitizeForLog([
        { apiKey: "sk-abcdefgh-very-long-1" },
        { apiKey: "sk-abcdefgh-very-long-2" },
      ]);
      expect(out[0].apiKey).toBe("sk-a...ng-1");
      expect(out[1].apiKey).toBe("sk-a...ng-2");
    });
    it("respects depth limit (no infinite recursion)", () => {
      const a = {};
      a.self = a;
      const out = sanitizeForLog(a);
      // Should terminate without throwing
      expect(out).toBeTruthy();
    });
    it("handles bigint", () => {
      const out = sanitizeForLog({ count: 12345n });
      expect(out.count).toBe("12345");
    });
  });

  describe("sanitizeForLog() — token-shape patterns in strings", () => {
    it("masks Bearer tokens inline", () => {
      const out = sanitizeForLog("Authorization: Bearer abcd1234567890abcdef");
      expect(out).toContain("Bear...");
      expect(out).not.toContain("abcd1234567890abcdef");
    });
    it("masks sk- API keys inline", () => {
      const out = sanitizeForLog("Sent request with sk-abcd1234567890abcd-suffix");
      expect(out).toContain("sk-a...");
      expect(out).not.toContain("sk-abcd1234567890abcd-suffix");
    });
    it("masks JWT tokens inline", () => {
      const out = sanitizeForLog("token=eyJhbGciOiJIUzI1NiJ9.payload.sig");
      expect(out).toContain("eyJh...");
      expect(out).not.toContain("eyJhbGciOiJIUzI1NiJ9.payload.sig");
    });
    it("does NOT mask short non-token strings", () => {
      const out = sanitizeForLog("user clicked button");
      expect(out).toBe("user clicked button");
    });
  });

  describe("logger.info/error — integration", () => {
    // Note: logger reads LOG_LEVEL once at import time. The default is INFO,
    // so info() and error() always run; debug() does not in test runs (without
    // ahead-of-import env setup). We exercise the integration via info/error.
    let consoleSpy;
    beforeEach(() => {
      consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    });
    afterEach(() => {
      consoleSpy.mockRestore();
    });

    it("info() never emits raw apiKey value (object form)", () => {
      info("AUTH", "checking key", { apiKey: "sk-abcdefghijklmnop-secret" });
      const out = consoleSpy.mock.calls.flat().join(" ");
      expect(out).not.toContain("sk-abcdefghijklmnop-secret");
      expect(out).toContain("sk-a...cret");
    });

    it("info() never emits Bearer token raw inside a string", () => {
      info("REQ", "Authorization: Bearer abcdefghijklmnop1234567890");
      const out = consoleSpy.mock.calls.flat().join(" ");
      expect(out).not.toContain("Bearer abcdefghijklmnop1234567890");
    });

    it("error() never emits raw access_token value", () => {
      error("REFRESH", "failed", { access_token: "tok-abcdefghijklmnop-secret" });
      const out = consoleSpy.mock.calls.flat().join(" ");
      expect(out).not.toContain("tok-abcdefghijklmnop-secret");
      expect(out).toContain("tok-...cret");
    });

    it("info() preserves non-sensitive context fields", () => {
      info("AUTH", "ok", { connectionId: "conn-123", providerId: "openai" });
      const out = consoleSpy.mock.calls.flat().join(" ");
      expect(out).toContain("conn-123");
      expect(out).toContain("openai");
    });

    it("does not throw on null/undefined data", () => {
      expect(() => info("X", "msg", null)).not.toThrow();
      expect(() => info("X", "msg", undefined)).not.toThrow();
      expect(() => info("X", "msg")).not.toThrow();
      expect(() => debug("X", "msg", null)).not.toThrow();
    });
  });
});
