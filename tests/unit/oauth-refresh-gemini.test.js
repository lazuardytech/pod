/**
 * Unit tests for Google OAuth token refresh
 *
 * refreshGoogleToken is used by gemini, gemini-cli, and antigravity providers.
 * Verifies:
 * - Successful refresh with optional token rotation
 * - 401 returns null
 * - Network error returns null
 * - Lead time (default 5 min for gemini/gemini-cli, 5 min for antigravity)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalFetch = global.fetch;

describe("Google OAuth Token Refresh (gemini / gemini-cli / antigravity)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe("refreshGoogleToken", () => {
    it("returns new access_token and rotated refresh_token on success", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: "new-google-access",
            refresh_token: "rotated-refresh",
            expires_in: 3600,
          }),
      });

      const { refreshGoogleToken } = await import("../../open-sse/services/tokenRefresh.js");
      const result = await refreshGoogleToken("old-refresh", "client-id", "client-secret", null);

      expect(result.accessToken).toBe("new-google-access");
      expect(result.refreshToken).toBe("rotated-refresh");
      expect(result.expiresIn).toBe(3600);
    });

    it("keeps old refresh_token when server does not return a new one", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: "another-access",
            expires_in: 3600,
          }),
      });

      const { refreshGoogleToken } = await import("../../open-sse/services/tokenRefresh.js");
      const result = await refreshGoogleToken("original-refresh", "cid", "csecret", null);

      expect(result.refreshToken).toBe("original-refresh");
      expect(result.accessToken).toBe("another-access");
    });

    it("returns null on 401 / invalid_grant", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve('{"error":"invalid_grant"}'),
      });

      const { refreshGoogleToken } = await import("../../open-sse/services/tokenRefresh.js");
      const result = await refreshGoogleToken("bad-token", "cid", "csecret", null);

      expect(result).toBeNull();
    });

    it("returns null on network error", async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error("network failure"));

      const { refreshGoogleToken } = await import("../../open-sse/services/tokenRefresh.js");
      const result = await refreshGoogleToken("some-token", "cid", "csecret", null);

      expect(result).toBeNull();
    });

    it("sends form-encoded payload to google token endpoint", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: "tok",
            expires_in: 3600,
          }),
      });
      global.fetch = fetchMock;

      const { refreshGoogleToken } = await import("../../open-sse/services/tokenRefresh.js");
      await refreshGoogleToken("rt-value", "my-client", "my-secret", null);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toBe("https://oauth2.googleapis.com/token");
      expect(opts.method).toBe("POST");
      expect(opts.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
      const body = new URLSearchParams(opts.body);
      expect(body.get("grant_type")).toBe("refresh_token");
      expect(body.get("refresh_token")).toBe("rt-value");
      expect(body.get("client_id")).toBe("my-client");
      expect(body.get("client_secret")).toBe("my-secret");
    });
  });

  describe("getRefreshLeadMs", () => {
    it("returns default buffer for gemini (no custom lead)", async () => {
      const { getRefreshLeadMs, TOKEN_EXPIRY_BUFFER_MS } = await import("../../open-sse/services/tokenRefresh.js");

      expect(getRefreshLeadMs("gemini")).toBe(TOKEN_EXPIRY_BUFFER_MS);
    });

    it("returns default buffer for gemini-cli (no custom lead)", async () => {
      const { getRefreshLeadMs, TOKEN_EXPIRY_BUFFER_MS } = await import("../../open-sse/services/tokenRefresh.js");

      expect(getRefreshLeadMs("gemini-cli")).toBe(TOKEN_EXPIRY_BUFFER_MS);
    });

    it("returns 5 minutes for antigravity", async () => {
      const { getRefreshLeadMs } = await import("../../open-sse/services/tokenRefresh.js");

      expect(getRefreshLeadMs("antigravity")).toBe(5 * 60 * 1000);
    });
  });
});
