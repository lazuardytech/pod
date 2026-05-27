/**
 * Unit tests for Qwen OAuth token refresh
 *
 * Verifies:
 * - Successful refresh with optional token rotation
 * - providerSpecificData with resource_url
 * - Non-200 response returns null
 * - Network error returns null
 * - Early-refresh lead time (20 minutes)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalFetch = global.fetch;

describe("Qwen OAuth Token Refresh", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe("refreshQwenToken", () => {
    it("returns new access_token and rotated refresh_token on success", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: "new-qwen-access",
            refresh_token: "rotated-qwen-refresh",
            expires_in: 86400,
          }),
      });

      const { refreshQwenToken } = await import("../../open-sse/services/tokenRefresh.js");
      const result = await refreshQwenToken("old-refresh", null);

      expect(result.accessToken).toBe("new-qwen-access");
      expect(result.refreshToken).toBe("rotated-qwen-refresh");
      expect(result.expiresIn).toBe(86400);
    });

    it("keeps old refresh_token when server does not return a new one", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: "new-qwen-access",
            expires_in: 86400,
          }),
      });

      const { refreshQwenToken } = await import("../../open-sse/services/tokenRefresh.js");
      const result = await refreshQwenToken("original-refresh", null);

      expect(result.refreshToken).toBe("original-refresh");
    });

    it("includes providerSpecificData when resource_url is present", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: "qwen-token",
            refresh_token: "new-refresh",
            expires_in: 86400,
            resource_url: "https://portal.qwen.ai/tenant/abc",
          }),
      });

      const { refreshQwenToken } = await import("../../open-sse/services/tokenRefresh.js");
      const result = await refreshQwenToken("old-refresh", null);

      expect(result.providerSpecificData).toEqual({ resourceUrl: "https://portal.qwen.ai/tenant/abc" });
    });

    it("does not include providerSpecificData when resource_url is absent", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: "qwen-token",
            expires_in: 86400,
          }),
      });

      const { refreshQwenToken } = await import("../../open-sse/services/tokenRefresh.js");
      const result = await refreshQwenToken("old-refresh", null);

      expect(result.providerSpecificData).toBeUndefined();
    });

    it("returns null on non-200 response (even with ok=true)", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        status: 400,
        ok: false,
        text: () => Promise.resolve('{"error":"invalid_grant"}'),
      });

      const { refreshQwenToken } = await import("../../open-sse/services/tokenRefresh.js");
      const result = await refreshQwenToken("bad-token", null);

      expect(result).toBeNull();
    });

    it("returns null on network error", async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error("timeout"));

      const { refreshQwenToken } = await import("../../open-sse/services/tokenRefresh.js");
      const result = await refreshQwenToken("some-token", null);

      expect(result).toBeNull();
    });

    it("sends form-encoded payload to qwen token endpoint", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: "tok",
            expires_in: 86400,
          }),
      });
      global.fetch = fetchMock;

      const { refreshQwenToken } = await import("../../open-sse/services/tokenRefresh.js");
      await refreshQwenToken("rt-456", null);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toBe("https://qwen.ai/api/v1/oauth2/token");
      expect(opts.method).toBe("POST");
      expect(opts.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
      const body = new URLSearchParams(opts.body);
      expect(body.get("grant_type")).toBe("refresh_token");
      expect(body.get("refresh_token")).toBe("rt-456");
    });
  });

  describe("getRefreshLeadMs", () => {
    it("returns 20 minutes for qwen", async () => {
      const { getRefreshLeadMs } = await import("../../open-sse/services/tokenRefresh.js");
      expect(getRefreshLeadMs("qwen")).toBe(20 * 60 * 1000);
    });
  });
});
