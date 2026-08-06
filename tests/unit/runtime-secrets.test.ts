import { describe, expect, it } from "vitest";
import {
  DEFAULT_API_KEY_SECRET,
  DEFAULT_JWT_SECRET,
  resolveApiKeySecret,
  validateStartupSecrets,
} from "../../src/lib/security/runtimeSecrets.mts";

describe("runtime secret policy", () => {
  it("accepts strong JWT_SECRET and API_KEY_SECRET at runtime", () => {
    expect(() =>
      validateStartupSecrets({
        NODE_ENV: "production",
        JWT_SECRET: "super-strong-jwt-secret",
        API_KEY_SECRET: "super-strong-api-key-secret",
      }),
    ).not.toThrow();
  });

  it("rejects missing JWT_SECRET outside build phase", () => {
    expect(() =>
      validateStartupSecrets({
        NODE_ENV: "production",
        JWT_SECRET: "",
        API_KEY_SECRET: "super-strong-api-key-secret",
      }),
    ).toThrow(/JWT_SECRET/);
  });

  it("rejects default API_KEY_SECRET outside build phase", () => {
    expect(() =>
      validateStartupSecrets({
        NODE_ENV: "production",
        JWT_SECRET: "super-strong-jwt-secret",
        API_KEY_SECRET: DEFAULT_API_KEY_SECRET,
      }),
    ).toThrow(/API_KEY_SECRET/);
  });

  it("skips startup validation during production build phase", () => {
    expect(() =>
      validateStartupSecrets({
        NODE_ENV: "production",
        NEXT_PHASE: "phase-production-build",
        JWT_SECRET: DEFAULT_JWT_SECRET,
        API_KEY_SECRET: DEFAULT_API_KEY_SECRET,
      }),
    ).not.toThrow();
  });

  it("provides a deterministic fallback secret for test env only", () => {
    expect(resolveApiKeySecret({ NODE_ENV: "test" })).toBe("test-api-key-secret");
    expect(resolveApiKeySecret({ NODE_ENV: "development" })).toBeNull();
  });
});
