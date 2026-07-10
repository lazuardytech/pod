import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

describe("MAX_REQUEST_BODY_BYTES / getMaxRequestBodyBytes", () => {
  const originalEnv = { ...process.env };
  beforeEach(() => {
    delete process.env.POD_MAX_REQUEST_BODY_BYTES;
    delete process.env.POD_MAX_CHAT_BODY_BYTES;
    vi.resetModules();
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("defaults to 50MB when env unset", async () => {
    const { MAX_REQUEST_BODY_BYTES, getMaxRequestBodyBytes } =
      await import("@/shared/constants/config");
    expect(MAX_REQUEST_BODY_BYTES).toBe(50 * 1024 * 1024);
    expect(getMaxRequestBodyBytes(false)).toBe(50 * 1024 * 1024);
  });

  it("uses POD_MAX_REQUEST_BODY_BYTES when set", async () => {
    process.env.POD_MAX_REQUEST_BODY_BYTES = "1048576"; // 1MB
    const { MAX_REQUEST_BODY_BYTES } = await import("@/shared/constants/config");
    expect(MAX_REQUEST_BODY_BYTES).toBe(1048576);
  });

  it("falls back to default when env is invalid (NaN)", async () => {
    process.env.POD_MAX_REQUEST_BODY_BYTES = "not-a-number";
    const { MAX_REQUEST_BODY_BYTES } = await import("@/shared/constants/config");
    expect(MAX_REQUEST_BODY_BYTES).toBe(50 * 1024 * 1024);
  });

  it("falls back to default when env is zero or negative", async () => {
    process.env.POD_MAX_REQUEST_BODY_BYTES = "0";
    const { MAX_REQUEST_BODY_BYTES: a } = await import("@/shared/constants/config");
    expect(a).toBe(50 * 1024 * 1024);

    delete process.env.POD_MAX_REQUEST_BODY_BYTES;
    process.env.POD_MAX_REQUEST_BODY_BYTES = "-100";
    const { MAX_REQUEST_BODY_BYTES: b } = await import("@/shared/constants/config");
    expect(b).toBe(50 * 1024 * 1024);
  });

  it("MAX_CHAT_BODY_BYTES defaults to MAX_REQUEST_BODY_BYTES when env unset", async () => {
    const { MAX_CHAT_BODY_BYTES, MAX_REQUEST_BODY_BYTES } =
      await import("@/shared/constants/config");
    expect(MAX_CHAT_BODY_BYTES).toBe(MAX_REQUEST_BODY_BYTES);
  });

  it("POD_MAX_CHAT_BODY_BYTES overrides chat cap independently", async () => {
    process.env.POD_MAX_REQUEST_BODY_BYTES = "1048576";
    process.env.POD_MAX_CHAT_BODY_BYTES = "2097152";
    const { MAX_REQUEST_BODY_BYTES, MAX_CHAT_BODY_BYTES, getMaxRequestBodyBytes } =
      await import("@/shared/constants/config");
    expect(MAX_REQUEST_BODY_BYTES).toBe(1048576);
    expect(MAX_CHAT_BODY_BYTES).toBe(2097152);
    expect(getMaxRequestBodyBytes(true)).toBe(2097152);
    expect(getMaxRequestBodyBytes(false)).toBe(1048576);
  });
});
