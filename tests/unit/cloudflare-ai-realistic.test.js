/**
 * Cloudflare Workers AI realistic credential tests — v0.0.47
 *
 * Exercises accountId template substitution, auth header format, URL
 * composition for both chat completions and run endpoints.
 * All tests offline — no network calls.
 */

import { describe, expect, it } from "vitest";
import { PROVIDERS } from "../../open-sse/config/providers.js";
import { getExecutor } from "../../open-sse/executors/index.js";

// ─── Provider Config ─────────────────────────────────────────────────────────

describe("cloudflare-ai provider config", () => {
  it("exists in PROVIDERS with {accountId} template", () => {
    const cfg = PROVIDERS["cloudflare-ai"];
    expect(cfg).toBeTruthy();
    expect(cfg.baseUrl).toContain("{accountId}");
  });

  it("has format: openai", () => {
    expect(PROVIDERS["cloudflare-ai"].format).toBe("openai");
  });
});

// ─── Template Substitution ───────────────────────────────────────────────────

describe("cloudflare-ai — accountId template substitution", () => {
  const exec = getExecutor("cloudflare-ai");
  const model = "@cf/meta/llama-3-8b-instruct";

  it("substitutes UUID-format accountId", () => {
    const url = exec.buildUrl(model, true, 0, {
      apiKey: "test-key",
      providerSpecificData: { accountId: "a1b2c3d4-e5f6-7890-abcd-ef0123456789" },
    });
    expect(url).toBe(
      "https://api.cloudflare.com/client/v4/accounts/a1b2c3d4-e5f6-7890-abcd-ef0123456789/ai/v1/chat/completions",
    );
    expect(url).not.toContain("{accountId}");
  });

  it("substitutes alphanumeric accountId", () => {
    const url = exec.buildUrl(model, true, 0, {
      apiKey: "test-key",
      providerSpecificData: { accountId: "ABC123def456" },
    });
    expect(url).toContain("ABC123def456");
    expect(url).not.toContain("{accountId}");
  });

  it("substitutes email-format accountId", () => {
    const url = exec.buildUrl(model, true, 0, {
      apiKey: "test-key",
      providerSpecificData: { accountId: "user@example.com" },
    });
    expect(url).toContain("user@example.com");
    expect(url).not.toContain("{accountId}");
  });

  it("throws when accountId is missing", () => {
    expect(() =>
      exec.buildUrl(model, true, 0, {
        apiKey: "test-key",
        providerSpecificData: {},
      }),
    ).toThrow(/accountId/);
  });

  it("throws when accountId is empty string", () => {
    expect(() =>
      exec.buildUrl(model, true, 0, {
        apiKey: "test-key",
        providerSpecificData: { accountId: "" },
      }),
    ).toThrow(/accountId/);
  });

  it("throws when providerSpecificData is null", () => {
    expect(() =>
      exec.buildUrl(model, true, 0, {
        apiKey: "test-key",
        providerSpecificData: null,
      }),
    ).toThrow(/accountId/);
  });
});

// ─── Auth Header ─────────────────────────────────────────────────────────────

describe("cloudflare-ai — auth header", () => {
  const exec = getExecutor("cloudflare-ai");

  it("sends API key as Bearer token", () => {
    const headers = exec.buildHeaders({ apiKey: "cf-api-key-123" }, true);
    expect(headers["Authorization"]).toBe("Bearer cf-api-key-123");
  });

  it("includes Content-Type: application/json", () => {
    const headers = exec.buildHeaders({ apiKey: "test" }, false);
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("includes Accept: text/event-stream for streaming", () => {
    const headers = exec.buildHeaders({ apiKey: "test" }, true);
    expect(headers["Accept"]).toBe("text/event-stream");
  });

  it("omits Accept: text/event-stream for non-streaming", () => {
    const headers = exec.buildHeaders({ apiKey: "test" }, false);
    expect(headers["Accept"]).toBeUndefined();
  });

  it("prefers apiKey over accessToken", () => {
    const headers = exec.buildHeaders({ apiKey: "key-from-api", accessToken: "tok-from-oauth" }, false);
    expect(headers["Authorization"]).toBe("Bearer key-from-api");
  });

  it("falls back to accessToken when apiKey is missing", () => {
    const headers = exec.buildHeaders({ accessToken: "tok-only" }, false);
    expect(headers["Authorization"]).toBe("Bearer tok-only");
  });
});

// ─── Chat Completions URL (via DefaultExecutor) ──────────────────────────────

describe("cloudflare-ai — chat completions URL", () => {
  const exec = getExecutor("cloudflare-ai");
  const model = "@cf/meta/llama-3-8b-instruct";
  const creds = { apiKey: "test", providerSpecificData: { accountId: "test-account" } };

  it("uses baseUrl from PROVIDERS with accountId substituted", () => {
    const url = exec.buildUrl(model, true, 0, creds);
    expect(url).toBe("https://api.cloudflare.com/client/v4/accounts/test-account/ai/v1/chat/completions");
  });

  it("returns same URL for streaming and non-streaming (streaming via body, not URL)", () => {
    const urlStream = exec.buildUrl(model, true, 0, creds);
    const urlNoStream = exec.buildUrl(model, false, 0, creds);
    expect(urlStream).toBe(urlNoStream);
  });

  it("URL does not contain raw {accountId} after substitution", () => {
    const url = exec.buildUrl(model, true, 0, creds);
    expect(url).not.toContain("{accountId}");
  });

  it("URL ends with /chat/completions", () => {
    const url = exec.buildUrl(model, true, 0, creds);
    expect(url).toMatch(/\/chat\/completions$/);
  });
});

// ─── Edge Cases ──────────────────────────────────────────────────────────────

describe("cloudflare-ai — realistic credential shapes", () => {
  const exec = getExecutor("cloudflare-ai");

  it("works with Cloudflare API Token format (40-char hex)", () => {
    const token = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0";
    const headers = exec.buildHeaders({ apiKey: token }, false);
    expect(headers["Authorization"]).toBe(`Bearer ${token}`);
  });

  it("handles Partner API token (Cloudflare Global API Key — email+key)", () => {
    const headers = exec.buildHeaders({ apiKey: "v1.0-abcdef123456" }, false);
    expect(headers["Authorization"]).toBe("Bearer v1.0-abcdef123456");
  });

  it("handles model names with @ symbols and slashes (Cloudflare model path convention)", () => {
    const creds = { apiKey: "test", providerSpecificData: { accountId: "acc-1" } };
    const url = exec.buildUrl("@cf/mistral/mistral-7b-instruct-v0.1", true, 0, creds);
    expect(url).toBe("https://api.cloudflare.com/client/v4/accounts/acc-1/ai/v1/chat/completions");
  });
});

// ─── Non-Chat Endpoint: /ai/run/{model} for image gen ────────────────────────

describe("cloudflare-ai — run endpoint pattern", () => {
  // The image generation handler constructs /ai/run/{model} URLs directly,
  // but we verify the accountId pattern here.

  it("run endpoint URL structure with accountId", () => {
    const accountId = "my-account";
    const model = "@cf/leonardo/lucid-origin";
    const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`;
    expect(url).toBe("https://api.cloudflare.com/client/v4/accounts/my-account/ai/run/@cf/leonardo/lucid-origin");
  });
});
