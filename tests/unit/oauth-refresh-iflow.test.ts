/**
 * Unit tests for iFlow OAuth token refresh
 *
 * Verifies:
 * - Successful refresh with Basic auth and optional token rotation
 * - 401 returns null
 * - Network error returns null
 * - Early-refresh lead time (24 hours)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalFetch = global.fetch;
const originalIflowSecret = process.env.IFLOW_OAUTH_CLIENT_SECRET;

describe("iFlow OAuth Token Refresh", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    process.env.IFLOW_OAUTH_CLIENT_SECRET = "test-iflow-secret";
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalIflowSecret === undefined) {
      delete process.env.IFLOW_OAUTH_CLIENT_SECRET;
    } else {
      process.env.IFLOW_OAUTH_CLIENT_SECRET = originalIflowSecret;
    }
  });

  describe("refreshIflowToken", () => {
    it("returns new access_token and rotated refresh_token on success", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: "new-iflow-access",
            refresh_token: "rotated-iflow-refresh",
            expires_in: 86400,
          }),
      });

      const { refreshIflowToken } = await import("../../open-sse/services/tokenRefresh.ts");
      const result = await refreshIflowToken("old-refresh", null);

      expect(result.accessToken).toBe("new-iflow-access");
      expect(result.refreshToken).toBe("rotated-iflow-refresh");
      expect(result.expiresIn).toBe(86400);
    });

    it("keeps old refresh_token when server does not return a new one", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: "new-iflow-access",
            expires_in: 86400,
          }),
      });

      const { refreshIflowToken } = await import("../../open-sse/services/tokenRefresh.ts");
      const result = await refreshIflowToken("original-refresh", null);

      expect(result.refreshToken).toBe("original-refresh");
    });

    it("returns null on 401 / invalid_grant", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve('{"error":"invalid_grant"}'),
      });

      const { refreshIflowToken } = await import("../../open-sse/services/tokenRefresh.ts");
      const result = await refreshIflowToken("bad-token", null);

      expect(result).toBeNull();
    });

    it("returns null on network error", async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error("connection refused"));

      const { refreshIflowToken } = await import("../../open-sse/services/tokenRefresh.ts");
      const result = await refreshIflowToken("some-token", null);

      expect(result).toBeNull();
    });

    it("sends Basic auth header and form-encoded payload", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: "tok",
            expires_in: 86400,
          }),
      });
      global.fetch = fetchMock;

      const { refreshIflowToken } = await import("../../open-sse/services/tokenRefresh.ts");
      await refreshIflowToken("rt-789", null);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toBe("https://iflow.cn/oauth/token");
      expect(opts.method).toBe("POST");
      expect(opts.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
      expect(opts.headers["Authorization"]).toMatch(/^Basic /);
      const body = new URLSearchParams(opts.body);
      expect(body.get("grant_type")).toBe("refresh_token");
      expect(body.get("refresh_token")).toBe("rt-789");
    });

    it("returns null and skips fetch when IFLOW_OAUTH_CLIENT_SECRET is missing", async () => {
      delete process.env.IFLOW_OAUTH_CLIENT_SECRET;
      const fetchMock = vi.fn();
      global.fetch = fetchMock;

      const { refreshIflowToken } = await import("../../open-sse/services/tokenRefresh.ts");
      const result = await refreshIflowToken("rt-missing", null);

      expect(result).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("getRefreshLeadMs", () => {
    it("returns 24 hours for iflow", async () => {
      const { getRefreshLeadMs } = await import("../../open-sse/services/tokenRefresh.ts");
      expect(getRefreshLeadMs("iflow")).toBe(24 * 60 * 60 * 1000);
    });
  });
});
