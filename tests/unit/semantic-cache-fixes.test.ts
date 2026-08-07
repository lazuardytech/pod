import { describe, expect, it, vi } from "vitest";

// Mock dependencies before importing the module under test
vi.mock("@/lib/sqlite/connection.ts", () => ({
  getDatabase: () => ({
    prepare: () => ({
      run: () => {},
      get: () => null,
    }),
  }),
}));

vi.mock("./src/lib/cacheLayer.js", () => ({
  LRUCache: class {
    get() {
      return null;
    }
    set() {}
    clear() {}
    delete() {}
    getStats() {
      return { size: 0 };
    }
  },
}));

vi.mock("@/lib/cacheLayer.js", () => ({
  LRUCache: class {
    get() {
      return null;
    }
    set() {}
    clear() {}
    delete() {}
    getStats() {
      return { size: 0 };
    }
  },
}));

// Import after mocks
const { generateSignature, isCacheableForRead, isCacheableForWrite } =
  await import("../../src/lib/semanticCache.js");

// MAX_SEMANTIC_CACHE_BYTES is not exported — test it via isSmallEnoughForSemanticCache
// which is local to chatCore. We test the constant indirectly by checking the
// boundary value in chatCore. Since it's not exported we verify the value by
// importing chatCore and checking the behaviour of isSmallEnoughForSemanticCache
// through a white-box approach: build a response whose content is exactly at the
// boundary and confirm caching decisions.
//
// For the constant value itself we read it from the source file.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const chatCoreSrc = readFileSync(
  resolve(import.meta.dirname, "../../open-sse/handlers/chatCore.ts"),
  "utf8",
);

describe("MAX_SEMANTIC_CACHE_BYTES", () => {
  it("is set to 512KB in chatCore.ts", () => {
    expect(chatCoreSrc).toContain("const MAX_SEMANTIC_CACHE_BYTES = 512 * 1024;");
  });

  it("does not contain the old 256KB value", () => {
    expect(chatCoreSrc).not.toContain("const MAX_SEMANTIC_CACHE_BYTES = 256 * 1024;");
  });
});

describe("generateSignature — memoryOwnerId isolation", () => {
  const model = "gpt-4o";
  const messages = [{ role: "user", content: "Hello" }];
  const temp = 0.7;
  const topP = 1;

  it("produces a different hash when memoryOwnerId is provided vs omitted", () => {
    const withOwner = generateSignature(model, messages, temp, topP, "user-abc");
    const withoutOwner = generateSignature(model, messages, temp, topP);
    expect(withOwner).not.toBe(withoutOwner);
  });

  it("produces a different hash when memoryOwnerId is provided vs null", () => {
    const withOwner = generateSignature(model, messages, temp, topP, "user-abc");
    const withNull = generateSignature(model, messages, temp, topP, null);
    expect(withOwner).not.toBe(withNull);
  });

  it("same memoryOwnerId + same messages → same hash (cache hit)", () => {
    const sig1 = generateSignature(model, messages, temp, topP, "user-abc");
    const sig2 = generateSignature(model, messages, temp, topP, "user-abc");
    expect(sig1).toBe(sig2);
  });

  it("different memoryOwnerId + same messages → different hash (no cross-user bleed)", () => {
    const sigA = generateSignature(model, messages, temp, topP, "user-alice");
    const sigB = generateSignature(model, messages, temp, topP, "user-bob");
    expect(sigA).not.toBe(sigB);
  });

  it("returns a 64-char hex string", () => {
    const sig = generateSignature(model, messages, temp, topP, "user-abc");
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("generateSignature — temperature default consistency", () => {
  const model = "gpt-4o";
  const messages = [{ role: "user", content: "Hi" }];

  it("temperature=null and temperature=1 produce the same hash", () => {
    const sigNull = generateSignature(model, messages, null, null);
    const sigOne = generateSignature(model, messages, 1, 1);
    expect(sigNull).toBe(sigOne);
  });

  it("temperature=undefined and temperature=1 produce the same hash", () => {
    const sigUndef = generateSignature(model, messages, undefined, undefined);
    const sigOne = generateSignature(model, messages, 1, 1);
    expect(sigUndef).toBe(sigOne);
  });

  it("temperature=0 and temperature=1 produce different hashes", () => {
    const sigZero = generateSignature(model, messages, 0, 1);
    const sigOne = generateSignature(model, messages, 1, 1);
    expect(sigZero).not.toBe(sigOne);
  });
});

describe("isCacheableForRead — temperature default consistency", () => {
  it("body with no temperature field is cacheable (default treated as 1)", () => {
    expect(isCacheableForRead({}, null)).toBe(true);
  });

  it("body with temperature=1 is cacheable", () => {
    expect(isCacheableForRead({ temperature: 1 }, null)).toBe(true);
  });

  it("body with no temperature and body with temperature=1 both pass (consistent default)", () => {
    const noTemp = isCacheableForRead({}, null);
    const explicitOne = isCacheableForRead({ temperature: 1 }, null);
    expect(noTemp).toBe(explicitOne);
  });

  it("temperature > 1 is not cacheable", () => {
    expect(isCacheableForRead({ temperature: 1.5 }, null)).toBe(false);
  });

  it("temperature = 0 is cacheable", () => {
    expect(isCacheableForRead({ temperature: 0 }, null)).toBe(true);
  });

  it("x-pod-no-cache: true disables caching regardless of temperature", () => {
    expect(isCacheableForRead({ temperature: 0 }, { "x-pod-no-cache": "true" })).toBe(false);
  });

  it("x-omniroute-no-cache: true disables caching", () => {
    expect(isCacheableForRead({}, { "x-omniroute-no-cache": "true" })).toBe(false);
  });
});

describe("isCacheableForWrite — temperature default consistency", () => {
  it("body with no temperature field is cacheable for write", () => {
    expect(isCacheableForWrite({}, null)).toBe(true);
  });

  it("body with temperature=1 is cacheable for write", () => {
    expect(isCacheableForWrite({ temperature: 1 }, null)).toBe(true);
  });

  it("temperature > 1 is not cacheable for write", () => {
    expect(isCacheableForWrite({ temperature: 2 }, null)).toBe(false);
  });

  it("x-pod-no-cache: true disables write caching", () => {
    expect(isCacheableForWrite({}, { "x-pod-no-cache": "true" })).toBe(false);
  });
});

describe("generateSignature — no temperature field produces same sig as temperature=1 AND passes isCacheableForRead", () => {
  it("a request with no temperature: signature matches temperature=1, and both are cacheable", () => {
    const model = "claude-3-5-sonnet";
    const messages = [{ role: "user", content: "test" }];

    const sigNoTemp = generateSignature(model, messages, undefined, undefined);
    const sigExplicit = generateSignature(model, messages, 1, 1);

    expect(sigNoTemp).toBe(sigExplicit);
    expect(isCacheableForRead({}, null)).toBe(true);
    expect(isCacheableForRead({ temperature: 1 }, null)).toBe(true);
  });
});
