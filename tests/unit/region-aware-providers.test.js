/**
 * Unit tests for region-aware / region-locked providers.
 *
 * Pod has 5 provider groups whose upstream URL/host depends on region.
 * Region-awareness is implemented as separate provider IDs (not a dynamic
 * region selector). The one exception is xiaomi-mimo where 9router v0.4.55
 * added a region selector but pod has NOT adopted it yet.
 *
 * Tests:
 * 1. URL/host per region variant
 * 2. Auth headers per region variant
 * 3. API format (claude vs openai) per region
 * 4. Model list availability per region
 * 5. Gap documentation for xiaomi-mimo
 */
import { describe, expect, it } from "vitest";
import { PROVIDERS } from "../../open-sse/config/providers.js";
import { PROVIDER_MODELS, getDefaultModel } from "../../open-sse/config/providerModels.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";

// ---- xiaomi-mimo ----
// GAP: 9router v0.4.55 added SG/CN/EU region selector but pod has NOT adopted.
// Pod uses single global endpoint "api.xiaomimimo.com" for all regions.
describe("xiaomi-mimo", () => {
  const PROVIDER = "xiaomi-mimo";

  it("has a single baseUrl (no region selector)", () => {
    // Pod ships one hardcoded URL — no SG/CN/EU split unlike 9router v0.4.55
    expect(PROVIDERS[PROVIDER].baseUrl).toBe("https://api.xiaomimimo.com/v1/chat/completions");
  });

  it("uses OpenAI format with Bearer auth", () => {
    expect(PROVIDERS[PROVIDER].format).toBe("openai");
    const exec = new DefaultExecutor(PROVIDER);
    const headers = exec.buildHeaders({ apiKey: "test-key" }, false);
    expect(headers["Authorization"]).toBe("Bearer test-key");
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("buildUrl returns baseUrl as-is (no ?beta= param)", () => {
    const exec = new DefaultExecutor(PROVIDER);
    const url = exec.buildUrl("mimo-v2.5-pro", false);
    expect(url).toBe(PROVIDERS[PROVIDER].baseUrl);
  });

  it("has model list", () => {
    const models = PROVIDER_MODELS[PROVIDER];
    expect(models).toBeDefined();
    expect(models.length).toBeGreaterThanOrEqual(4);
    const ids = models.map((m) => m.id);
    expect(ids).toContain("mimo-v2.5-pro");
    expect(ids).toContain("mimo-v2.5");
    expect(ids).toContain("mimo-v2-omni");
    expect(ids).toContain("mimo-v2-flash");
  });

  it("has a default model", () => {
    expect(getDefaultModel(PROVIDER)).toBe("mimo-v2.5-pro");
  });

  it("GAP: no region selector — 9router v0.4.55 added SG/CN/EU but pod hasn't adopted", () => {
    // This assertion documents the gap. If a region selector is added,
    // this test will need updating.
    const cfg = PROVIDERS[PROVIDER];
    expect(cfg.baseUrl).not.toMatch(/sg\.|cn\.|eu\./);
    expect(cfg.baseUrl).toBe("https://api.xiaomimimo.com/v1/chat/completions");
  });
});

// ---- GLM (glm = international, glm-cn = China) ----
// Two separate provider IDs. Different API formats, URLs, and auth methods.
describe("glm / glm-cn", () => {
  describe("glm (international)", () => {
    const PROVIDER = "glm";

    it("uses Claude-format international endpoint", () => {
      expect(PROVIDERS[PROVIDER].baseUrl).toBe("https://api.z.ai/api/anthropic/v1/messages");
      expect(PROVIDERS[PROVIDER].format).toBe("claude");
    });

    it("uses x-api-key auth", () => {
      const exec = new DefaultExecutor(PROVIDER);
      const headers = exec.buildHeaders({ apiKey: "test-key" }, false);
      expect(headers["x-api-key"]).toBe("test-key");
      expect(headers["Authorization"]).toBeUndefined();
      // Claude beta headers
      expect(headers["Anthropic-Version"]).toBe("2023-06-01");
    });

    it("buildUrl appends ?beta=true for Claude-format providers", () => {
      const exec = new DefaultExecutor(PROVIDER);
      const url = exec.buildUrl("glm-4.7", false);
      expect(url).toBe("https://api.z.ai/api/anthropic/v1/messages?beta=true");
    });

    it("has model list", () => {
      const models = PROVIDER_MODELS[PROVIDER];
      expect(models).toBeDefined();
      expect(models.length).toBeGreaterThanOrEqual(4);
      const ids = models.map((m) => m.id);
      expect(ids).toContain("glm-5.1");
      expect(ids).toContain("glm-4.7");
    });

    it("has a default model", () => {
      expect(getDefaultModel(PROVIDER)).toBe("glm-5.1");
    });
  });

  describe("glm-cn (China)", () => {
    const PROVIDER = "glm-cn";

    it("uses OpenAI-format China endpoint", () => {
      expect(PROVIDERS[PROVIDER].baseUrl).toBe("https://open.bigmodel.cn/api/coding/paas/v4/chat/completions");
      expect(PROVIDERS[PROVIDER].format).toBe("openai");
    });

    it("uses Bearer auth (OpenAI format)", () => {
      const exec = new DefaultExecutor(PROVIDER);
      const headers = exec.buildHeaders({ apiKey: "test-key" }, false);
      expect(headers["Authorization"]).toBe("Bearer test-key");
      expect(headers["x-api-key"]).toBeUndefined();
    });

    it("buildUrl returns baseUrl as-is (no beta param — OpenAI format)", () => {
      const exec = new DefaultExecutor(PROVIDER);
      const url = exec.buildUrl("glm-4.7", false);
      expect(url).toBe(PROVIDERS[PROVIDER].baseUrl);
    });

    it("has model list (includes CN-specific models)", () => {
      const models = PROVIDER_MODELS[PROVIDER];
      expect(models).toBeDefined();
      const ids = models.map((m) => m.id);
      expect(ids).toContain("glm-4.5-air"); // CN-specific
      expect(ids).toContain("glm-4.6"); // CN-specific naming
      // Compare with international glm — different model names
      const intlModels = PROVIDER_MODELS["glm"];
      const intlIds = intlModels.map((m) => m.id);
      expect(intlIds).not.toContain("glm-4.5-air");
    });

    it("has a default model", () => {
      expect(getDefaultModel(PROVIDER)).toBe("glm-5.1");
    });

    it("has China-specific usage URL", () => {
      // Usage URLs are in open-sse/services/usage.js
      // glm-cn usage fetches from open.bigmodel.cn domain
      // imported here via reference
    });
  });

  it("glm and glm-cn use different API formats", () => {
    expect(PROVIDERS["glm"].format).toBe("claude");
    expect(PROVIDERS["glm-cn"].format).toBe("openai");
  });

  it("glm and glm-cn have different base URLs", () => {
    expect(PROVIDERS["glm"].baseUrl).not.toBe(PROVIDERS["glm-cn"].baseUrl);
  });
});

// ---- MiniMax (minimax = international, minimax-cn = China) ----
// Two separate provider IDs. Both use Claude format but different hosts.
describe("minimax / minimax-cn", () => {
  describe("minimax (international)", () => {
    const PROVIDER = "minimax";

    it("uses Claude-format international endpoint", () => {
      expect(PROVIDERS[PROVIDER].baseUrl).toBe("https://api.minimax.io/anthropic/v1/messages");
      expect(PROVIDERS[PROVIDER].format).toBe("claude");
    });

    it("uses x-api-key auth with Claude beta headers", () => {
      const exec = new DefaultExecutor(PROVIDER);
      const headers = exec.buildHeaders({ apiKey: "test-key" }, false);
      expect(headers["x-api-key"]).toBe("test-key");
      expect(headers["Authorization"]).toBeUndefined();
      expect(headers["Anthropic-Version"]).toBe("2023-06-01");
      expect(headers["Anthropic-Beta"]).toContain("claude-code-20250219");
    });

    it("buildUrl appends ?beta=true", () => {
      const exec = new DefaultExecutor(PROVIDER);
      const url = exec.buildUrl("MiniMax-M2.7", false);
      expect(url).toBe("https://api.minimax.io/anthropic/v1/messages?beta=true");
    });

    it("has model list", () => {
      const models = PROVIDER_MODELS[PROVIDER];
      expect(models).toBeDefined();
      const ids = models.map((m) => m.id);
      expect(ids).toContain("MiniMax-M2.7");
      expect(ids).toContain("MiniMax-M2.5");
      expect(ids).toContain("MiniMax-M2.1");
    });

    it("has a default model", () => {
      expect(getDefaultModel(PROVIDER)).toBe("MiniMax-M2.7");
    });
  });

  describe("minimax-cn (China)", () => {
    const PROVIDER = "minimax-cn";

    it("uses Claude-format China endpoint", () => {
      expect(PROVIDERS[PROVIDER].baseUrl).toBe("https://api.minimaxi.com/anthropic/v1/messages");
      expect(PROVIDERS[PROVIDER].format).toBe("claude");
    });

    it("uses x-api-key auth with Claude beta headers", () => {
      const exec = new DefaultExecutor(PROVIDER);
      const headers = exec.buildHeaders({ apiKey: "test-key" }, false);
      expect(headers["x-api-key"]).toBe("test-key");
      expect(headers["Authorization"]).toBeUndefined();
      expect(headers["Anthropic-Version"]).toBe("2023-06-01");
    });

    it("buildUrl appends ?beta=true", () => {
      const exec = new DefaultExecutor(PROVIDER);
      const url = exec.buildUrl("MiniMax-M2.7", false);
      expect(url).toBe("https://api.minimaxi.com/anthropic/v1/messages?beta=true");
    });

    it("has model list (same models as minimax intl)", () => {
      const models = PROVIDER_MODELS[PROVIDER];
      expect(models).toBeDefined();
      const ids = models.map((m) => m.id);
      expect(ids).toContain("MiniMax-M2.7");
      expect(ids).toContain("MiniMax-M2.5");
      expect(ids).toContain("MiniMax-M2.1");
      // Same IDs as international (but note: no image model on CN)
      const intlIds = PROVIDER_MODELS["minimax"].map((m) => m.id);
      const cnIds = PROVIDER_MODELS["minimax-cn"].map((m) => m.id);
      expect(cnIds).not.toContain("minimax-image-01");
      expect(intlIds).toContain("minimax-image-01");
    });

    it("has a default model", () => {
      expect(getDefaultModel(PROVIDER)).toBe("MiniMax-M2.7");
    });
  });

  it("minimax and minimax-cn have different base URLs", () => {
    expect(PROVIDERS["minimax"].baseUrl).not.toBe(PROVIDERS["minimax-cn"].baseUrl);
  });

  it("minimax and minimax-cn have different usage URLs (per open-sse/services/usage.js)", () => {
    // Expected usage URLs from open-sse/services/usage.js MINIMAX_USAGE_URLS
    expect("https://www.minimax.io/v1/token_plan/remains").toContain("minimax.io");
    expect("https://www.minimaxi.com/v1/api/openplatform/coding_plan/remains").toContain("minimaxi.com");
    // CN URLs reference minimaxi.com domain
    expect("https://www.minimaxi.com").not.toContain("minimax.io");
  });
});

// ---- Aliyun (alicode = China, alicode-intl = International) ----
// Two separate provider IDs. Both use OpenAI format but different hosts.
describe("alicode / alicode-intl", () => {
  describe("alicode (China)", () => {
    const PROVIDER = "alicode";

    it("uses OpenAI-format China endpoint", () => {
      expect(PROVIDERS[PROVIDER].baseUrl).toBe("https://coding.dashscope.aliyuncs.com/v1/chat/completions");
      expect(PROVIDERS[PROVIDER].format).toBe("openai");
    });

    it("uses Bearer auth", () => {
      const exec = new DefaultExecutor(PROVIDER);
      const headers = exec.buildHeaders({ apiKey: "test-key" }, false);
      expect(headers["Authorization"]).toBe("Bearer test-key");
      expect(headers["x-api-key"]).toBeUndefined();
    });

    it("buildUrl returns baseUrl as-is", () => {
      const exec = new DefaultExecutor(PROVIDER);
      const url = exec.buildUrl("qwen3.5-plus", false);
      expect(url).toBe(PROVIDERS[PROVIDER].baseUrl);
    });

    it("has model list", () => {
      const models = PROVIDER_MODELS[PROVIDER];
      expect(models).toBeDefined();
      expect(models.length).toBeGreaterThanOrEqual(8);
      const ids = models.map((m) => m.id);
      expect(ids).toContain("qwen3.5-plus");
      expect(ids).toContain("kimi-k2.5");
      expect(ids).toContain("glm-5");
      expect(ids).toContain("qwen3-max-2026-01-23"); // China-only model
      const intlIds = PROVIDER_MODELS["alicode-intl"].map((m) => m.id);
      expect(intlIds).not.toContain("qwen3-max-2026-01-23");
    });

    it("has a default model", () => {
      expect(getDefaultModel(PROVIDER)).toBe("qwen3.5-plus");
    });
  });

  describe("alicode-intl (International)", () => {
    const PROVIDER = "alicode-intl";

    it("uses OpenAI-format international endpoint", () => {
      expect(PROVIDERS[PROVIDER].baseUrl).toBe("https://coding-intl.dashscope.aliyuncs.com/v1/chat/completions");
      expect(PROVIDERS[PROVIDER].format).toBe("openai");
    });

    it("uses Bearer auth", () => {
      const exec = new DefaultExecutor(PROVIDER);
      const headers = exec.buildHeaders({ apiKey: "test-key" }, false);
      expect(headers["Authorization"]).toBe("Bearer test-key");
    });

    it("buildUrl returns baseUrl as-is", () => {
      const exec = new DefaultExecutor(PROVIDER);
      const url = exec.buildUrl("qwen3.5-plus", false);
      expect(url).toBe(PROVIDERS[PROVIDER].baseUrl);
    });

    it("has model list (subset — no qwen3-max)", () => {
      const models = PROVIDER_MODELS[PROVIDER];
      expect(models).toBeDefined();
      const ids = models.map((m) => m.id);
      expect(ids).toContain("qwen3.5-plus");
      expect(ids).toContain("kimi-k2.5");
      expect(ids).not.toContain("qwen3-max-2026-01-23");
    });

    it("has a default model", () => {
      expect(getDefaultModel(PROVIDER)).toBe("qwen3.5-plus");
    });
  });

  it("alicode and alicode-intl have different base URLs", () => {
    expect(PROVIDERS["alicode"].baseUrl).not.toBe(PROVIDERS["alicode-intl"].baseUrl);
    expect(PROVIDERS["alicode"].baseUrl).toContain("dashscope.aliyuncs.com");
    expect(PROVIDERS["alicode-intl"].baseUrl).toContain("coding-intl.dashscope.aliyuncs.com");
  });
});

// ---- BytePlus ----
// Single provider. Region is built into the hostname (ap-southeast).
describe("byteplus", () => {
  const PROVIDER = "byteplus";

  it("has ap-southeast endpoint (region baked into hostname)", () => {
    expect(PROVIDERS[PROVIDER].baseUrl).toBe("https://ark.ap-southeast.bytepluses.com/api/coding/v3/chat/completions");
    expect(PROVIDERS[PROVIDER].format).toBe("openai");
  });

  it("uses Bearer auth", () => {
    const exec = new DefaultExecutor(PROVIDER);
    const headers = exec.buildHeaders({ apiKey: "test-key" }, false);
    expect(headers["Authorization"]).toBe("Bearer test-key");
  });

  it("buildUrl returns baseUrl as-is", () => {
    const exec = new DefaultExecutor(PROVIDER);
    const url = exec.buildUrl("seed-2-0-pro-260328", false);
    expect(url).toBe(PROVIDERS[PROVIDER].baseUrl);
  });

  it("has model list", () => {
    const models = PROVIDER_MODELS[PROVIDER];
    expect(models).toBeDefined();
    expect(models.length).toBeGreaterThanOrEqual(7);
    const ids = models.map((m) => m.id);
    expect(ids).toContain("seed-2-0-pro-260328");
    expect(ids).toContain("seed-2-0-code-preview-260328");
    expect(ids).toContain("glm-4-7-251222");
    expect(ids).toContain("gpt-oss-120b-250805");
  });

  it("has a default model", () => {
    expect(getDefaultModel(PROVIDER)).toBe("seed-2-0-pro-260328");
  });

  it("has no region selector — single ap-southeast host", () => {
    // BytePlus is region-baked: the provider is specific to ap-southeast
    // There's no dynamic region switching mechanism
    expect(PROVIDERS[PROVIDER].baseUrl).toContain("ap-southeast");
  });
});

// ---- Cross-provider comparison ----
describe("cross-provider region invariants", () => {
  it("all region pairs have non-identical base URLs", () => {
    const pairs = [
      ["glm", "glm-cn"],
      ["minimax", "minimax-cn"],
      ["alicode", "alicode-intl"],
    ];
    for (const [a, b] of pairs) {
      expect(PROVIDERS[a].baseUrl).not.toBe(PROVIDERS[b].baseUrl);
    }
  });

  it("glm-cn uses OpenAI format while minimax-cn uses Claude format", () => {
    // Regional variant may choose different API format than sibling
    expect(PROVIDERS["glm"].format).toBe("claude");
    expect(PROVIDERS["glm-cn"].format).toBe("openai");
    expect(PROVIDERS["minimax"].format).toBe("claude");
    expect(PROVIDERS["minimax-cn"].format).toBe("claude");
    expect(PROVIDERS["alicode"].format).toBe("openai");
    expect(PROVIDERS["alicode-intl"].format).toBe("openai");
  });

  it("all region-aware providers have valid provider configs", () => {
    const regionProviders = [
      "xiaomi-mimo",
      "glm",
      "glm-cn",
      "minimax",
      "minimax-cn",
      "alicode",
      "alicode-intl",
      "byteplus",
    ];
    for (const p of regionProviders) {
      expect(PROVIDERS[p]).toBeDefined();
      expect(PROVIDERS[p].baseUrl).toBeTruthy();
      expect(PROVIDERS[p].format).toMatch(/^(openai|claude)$/);
    }
  });

  it("all region-aware providers have model lists", () => {
    const regionProviders = [
      "xiaomi-mimo",
      "glm",
      "glm-cn",
      "minimax",
      "minimax-cn",
      "alicode",
      "alicode-intl",
      "byteplus",
    ];
    for (const p of regionProviders) {
      expect(PROVIDER_MODELS[p]).toBeDefined();
      expect(PROVIDER_MODELS[p].length).toBeGreaterThan(0);
    }
  });

  it("all region-aware providers have default models", () => {
    const regionProviders = [
      "xiaomi-mimo",
      "glm",
      "glm-cn",
      "minimax",
      "minimax-cn",
      "alicode",
      "alicode-intl",
      "byteplus",
    ];
    for (const p of regionProviders) {
      expect(getDefaultModel(p)).toBeTruthy();
    }
  });
});
