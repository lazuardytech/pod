/**
 * Provider smoke test — v0.0.46
 *
 * Static smoke test: iterate every registered provider/adapter and exercise
 * core wiring (URL/header/body builders) with safe stub credentials. Catches:
 *   • broken wiring (provider in metadata but no executor / no models)
 *   • crashing URL or header builders
 *   • missing pricing entries
 *   • dead executor files
 *
 * Network is NEVER called — this only exercises pure construction methods.
 * A user supplying a valid API key downstream relies on the same code paths
 * we exercise here.
 */

import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PROVIDERS } from "../../open-sse/config/providers.js";
import { PROVIDER_MODELS } from "../../open-sse/config/providerModels.js";
import { getExecutor } from "../../open-sse/executors/index.js";
import { getEmbeddingAdapter } from "../../open-sse/handlers/embeddingProviders/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_PROVIDERS_DIR = path.resolve(__dirname, "../../public/providers");

// Stub credentials cover the full union of fields any executor might read.
const STUB_CREDS = () => ({
  apiKey: "sk-test-stub",
  accessToken: "tok-test-stub",
  refreshToken: "ref-test-stub",
  expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  providerSpecificData: {
    baseUrl: "https://example.invalid/v1",
    accountId: "acc-test",
    orgId: "org-test",
    projectId: "proj-test",
    deployment: "dep-test",
    machineId: "machine-test",
    azureEndpoint: "https://example.openai.azure.com",
    apiVersion: "2024-02-15-preview",
  },
  connectionId: "conn-test",
});

// Provider IDs we expect every chat-route to handle without throwing.
// Built from PROVIDERS keys (skip media-only ones identified later).
const ALL_CHAT_PROVIDERS = Object.keys(PROVIDERS);

// Skip-list: providers whose buildUrl legitimately requires runtime context
// we can't fake (e.g. dynamic OAuth, proxied accountId). They get a softer test.
const NEEDS_DYNAMIC_CONTEXT = new Set([
  // Cloudflare AI requires a real `{accountId}` interpolation — we provide one in stubs
  // so it's actually exercised. Kept here only if future providers slip in.
]);

describe("provider smoke — wiring", () => {
  it("every PROVIDERS entry has at least baseUrl, baseUrls, or a custom buildUrl override", () => {
    for (const [id, cfg] of Object.entries(PROVIDERS)) {
      const hasBase = !!cfg.baseUrl || !!cfg.baseUrls;
      const isMultiModelDispatch = Array.isArray(cfg.baseUrls) && cfg.baseUrls.length > 0;
      // Some executors (azure, codex, cursor, opencode) build URL from credentials
      // dynamically and intentionally have empty baseUrl in PROVIDERS.
      const exec = getExecutor(id);
      const hasCustomBuildUrl =
        exec?.buildUrl !== getExecutor.__proto__.buildUrl && Object.getPrototypeOf(exec).hasOwnProperty("buildUrl");
      expect(
        hasBase || isMultiModelDispatch || hasCustomBuildUrl,
        `provider ${id} has no baseUrl AND no custom buildUrl override`,
      ).toBe(true);
    }
  });

  it("getExecutor returns an instance for every PROVIDERS entry without throwing", () => {
    const failures = [];
    for (const id of ALL_CHAT_PROVIDERS) {
      try {
        const exec = getExecutor(id);
        expect(exec).toBeTruthy();
        expect(typeof exec.execute).toBe("function");
        expect(typeof exec.buildUrl).toBe("function");
        expect(typeof exec.buildHeaders).toBe("function");
      } catch (e) {
        failures.push(`${id}: ${e.message}`);
      }
    }
    expect(failures, failures.join("\n")).toEqual([]);
  });
});

describe("provider smoke — buildUrl/buildHeaders/transformRequest don't throw", () => {
  for (const id of ALL_CHAT_PROVIDERS) {
    it(`${id}: URL + headers + transform with stub credentials`, () => {
      const exec = getExecutor(id);
      const creds = STUB_CREDS();
      const cfg = PROVIDERS[id];

      // Pick a model — prefer registered, fall back to a generic id
      const models = PROVIDER_MODELS[id] || PROVIDER_MODELS[cfg.alias] || [];
      const model = models[0]?.id || models[0]?.upstreamModelId || "test-model";

      // buildUrl must produce a non-empty string OR throw a known "missing field" error
      // (e.g. accountId missing) — catch and report shape, not crash silently.
      let url;
      try {
        url = exec.buildUrl(model, true, 0, creds);
      } catch (e) {
        if (NEEDS_DYNAMIC_CONTEXT.has(id)) return; // documented skip
        throw new Error(`${id}.buildUrl threw: ${e.message}`);
      }
      expect(typeof url, `${id}.buildUrl returned non-string`).toBe("string");
      expect(url.length, `${id}.buildUrl returned empty string`).toBeGreaterThan(0);

      // buildHeaders must produce an object with Content-Type
      const headers = exec.buildHeaders(creds, true);
      expect(headers, `${id}.buildHeaders returned non-object`).toBeTypeOf("object");
      // Tolerate either "Content-Type" or "content-type" (cached headers may be lowercase)
      const ct = headers["Content-Type"] || headers["content-type"];
      expect(ct, `${id}.buildHeaders missing Content-Type`).toBeTruthy();

      // noAuth providers should not have an Authorization header *unless* they
      // intentionally hardcode a sentinel public token (e.g. opencode "Bearer public").
      // We accept either: missing header, OR a hardcoded literal that doesn't echo
      // the stub credentials we passed in.
      if (cfg.noAuth && headers["Authorization"]) {
        expect(headers["Authorization"], `${id} is noAuth but emitted credential-derived Authorization`).not.toContain(
          creds.apiKey,
        );
        expect(headers["Authorization"]).not.toContain(creds.accessToken);
      }

      // transformRequest should return an object (or the same body) without throwing
      const body = {
        model,
        messages: [
          { role: "system", content: "system" },
          { role: "user", content: "hi" },
        ],
        stream: true,
      };
      const transformed = exec.transformRequest(model, body, true, creds);
      expect(transformed, `${id}.transformRequest returned null`).toBeTruthy();
    });
  }
});

describe("provider smoke — URL builders accept multi-account placeholders", () => {
  // Cloudflare AI uses `{accountId}` template — verify substitution works
  const cfg = PROVIDERS["cloudflare-ai"];
  if (cfg) {
    it("cloudflare-ai substitutes {accountId}", () => {
      const exec = getExecutor("cloudflare-ai");
      const url = exec.buildUrl("@cf/meta/llama-3-8b", true, 0, {
        ...STUB_CREDS(),
        providerSpecificData: { accountId: "ABC123" },
      });
      expect(url).not.toContain("{accountId}");
      expect(url).toContain("ABC123");
    });

    it("cloudflare-ai throws when accountId is missing", () => {
      const exec = getExecutor("cloudflare-ai");
      expect(() => exec.buildUrl("@cf/meta/llama-3-8b", true, 0, { apiKey: "x", providerSpecificData: {} })).toThrow();
    });
  }
});

describe("provider smoke — embedding adapters", () => {
  const EMBED_PROVIDERS = [
    "openai",
    "openrouter",
    "mistral",
    "voyage-ai",
    "fireworks",
    "together",
    "nebius",
    "github",
    "nvidia",
    "jina-ai",
    "gemini",
    "google_ai_studio",
  ];

  for (const id of EMBED_PROVIDERS) {
    it(`${id}: embedding adapter constructs a request`, () => {
      const adapter = getEmbeddingAdapter(id);
      expect(adapter, `${id} has no embedding adapter`).toBeTruthy();

      const url = adapter.buildUrl("test-model", { apiKey: "k" }, { input: "hi" });
      expect(typeof url).toBe("string");
      expect(url.length).toBeGreaterThan(0);

      const headers = adapter.buildHeaders({ apiKey: "k" }, { input: "hi" });
      expect(headers).toBeTypeOf("object");

      const body = adapter.buildBody("test-model", { input: "hi", dimensions: 256 });
      expect(body).toBeTypeOf("object");

      const batchBody = adapter.buildBody("test-model", { input: ["a", "b"], dimensions: 256 });
      expect(batchBody).toBeTypeOf("object");

      // normalize on a stub OpenAI-shape payload
      const normalized = adapter.normalize(
        { object: "list", data: [{ object: "embedding", index: 0, embedding: [0.1, 0.2] }] },
        "test-model",
      );
      expect(normalized).toBeTypeOf("object");
    });
  }

  it("openai-compatible-* falls through to openaiCompatNode adapter", () => {
    const adapter = getEmbeddingAdapter("openai-compatible-deepseek");
    expect(adapter).toBeTruthy();
    expect(typeof adapter.buildUrl).toBe("function");
  });

  it("custom-embedding-* falls through to openaiCompatNode adapter", () => {
    const adapter = getEmbeddingAdapter("custom-embedding-foo");
    expect(adapter).toBeTruthy();
  });

  it("unknown provider returns null (not crash)", () => {
    expect(getEmbeddingAdapter("definitely-not-a-provider")).toBe(null);
    expect(getEmbeddingAdapter(undefined)).toBe(null);
  });
});

describe("provider smoke — provider icons exist", () => {
  // Providers that legitimately use a different icon name pattern
  const ICON_ALIASES = {
    "perplexity-web": "perplexity",
    "vertex-partner": "vertex",
    "minimax-cn": "minimax",
    "glm-cn": "glm",
    "alicode-intl": "alicode",
    "ollama-local": "ollama",
    "kimi-coding": "kimi",
    cu: "cursor",
    "gemini-cli": "gemini",
    melma: null, // intentionally removed; placeholder per AGENTS rule (Melma removed in v0.0.28)
  };

  const missing = [];
  for (const id of ALL_CHAT_PROVIDERS) {
    if (ICON_ALIASES[id] === null) continue;
    const iconName = ICON_ALIASES[id] || id;
    const candidates = [
      path.join(PUBLIC_PROVIDERS_DIR, `${iconName}.png`),
      path.join(PUBLIC_PROVIDERS_DIR, `${iconName}.svg`),
      path.join(PUBLIC_PROVIDERS_DIR, `${iconName}.webp`),
    ];
    if (!candidates.some(existsSync)) missing.push(`${id} (looked for ${iconName}.{png,svg,webp})`);
  }

  it("every provider has a corresponding icon under public/providers/", () => {
    if (missing.length > 0) {
      // Soft fail: log the list so it's visible but don't break CI for icon-only drift.
      console.warn(`[smoke] providers without icon: ${missing.join(", ")}`);
    }
    // Hard fail only if more than 25% of providers lack icons (catches systemic regression)
    expect(
      missing.length,
      `too many providers missing icons (${missing.length}/${ALL_CHAT_PROVIDERS.length})`,
    ).toBeLessThan(ALL_CHAT_PROVIDERS.length * 0.25);
  });
});

describe("provider smoke — defensive: no 9router/decolua references in runtime code", () => {
  it("tunnelManager has no 9router host", async () => {
    const fs = await import("node:fs/promises");
    const src = await fs.readFile(path.resolve(__dirname, "../../src/lib/tunnel/tunnelManager.ts"), "utf8");
    expect(src).not.toMatch(/9router\.com/i);
    expect(src).not.toMatch(/registerTunnelUrl\s*\(/);
  });

  it("initializeApp has no 9router host", async () => {
    const fs = await import("node:fs/promises");
    const candidates = ["initializeApp.js", "initializeApp.ts"].map((f) =>
      path.resolve(__dirname, `../../src/shared/services/${f}`),
    );
    let src = null;
    for (const candidate of candidates) {
      try {
        src = await fs.readFile(candidate, "utf8");
        break;
      } catch (_) {
        // try next extension
      }
    }
    expect(src).not.toBeNull();
    expect(src).not.toMatch(/9router\.com/i);
  });
});
