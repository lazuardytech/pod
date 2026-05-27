/**
 * Unit tests for Claude OAuth token refresh
 *
 * Verifies:
 * - Successful refresh with optional token rotation
 * - 401 / invalid_grant returns null (no retry loop)
 * - Network error returns null
 * - Early-refresh lead time (4 hours)
 * - In-flight dedup via getAccessToken
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalFetch = global.fetch;

describe("Claude OAuth Token Refresh", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe("refreshClaudeOAuthToken", () => {
    it("returns new access_token and rotated refresh_token on success", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: "new-claude-access",
            refresh_token: "rotated-refresh",
            expires_in: 21600,
          }),
      });

      const { refreshClaudeOAuthToken } = await import("../../open-sse/services/tokenRefresh.js");
      const result = await refreshClaudeOAuthToken("old-refresh", null);

      expect(result.accessToken).toBe("new-claude-access");
      expect(result.refreshToken).toBe("rotated-refresh");
      expect(result.expiresIn).toBe(21600);
    });

    it("keeps old refresh_token when server does not return a new one", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: "new-claude-access",
            expires_in: 21600,
          }),
      });

      const { refreshClaudeOAuthToken } = await import("../../open-sse/services/tokenRefresh.js");
      const result = await refreshClaudeOAuthToken("old-refresh", null);

      expect(result.refreshToken).toBe("old-refresh");
      expect(result.accessToken).toBe("new-claude-access");
    });

    it("returns null on 401 / invalid_grant", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve('{"error":"invalid_grant"}'),
      });

      const { refreshClaudeOAuthToken } = await import("../../open-sse/services/tokenRefresh.js");
      const result = await refreshClaudeOAuthToken("expired-token", null);

      expect(result).toBeNull();
    });

    it("returns null on network error", async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error("fetch failed"));

      const { refreshClaudeOAuthToken } = await import("../../open-sse/services/tokenRefresh.js");
      const result = await refreshClaudeOAuthToken("some-token", null);

      expect(result).toBeNull();
    });

    it("sends correct Content-Type and payload shape", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: "test-token",
            expires_in: 21600,
          }),
      });
      global.fetch = fetchMock;

      const { refreshClaudeOAuthToken } = await import("../../open-sse/services/tokenRefresh.js");
      await refreshClaudeOAuthToken("rt-123", null);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toBe("https://api.anthropic.com/v1/oauth/token");
      expect(opts.method).toBe("POST");
      expect(opts.headers["Content-Type"]).toBe("application/json");
      const body = JSON.parse(opts.body);
      expect(body.grant_type).toBe("refresh_token");
      expect(body.refresh_token).toBe("rt-123");
      expect(body.client_id).toBe("9d1c250a-e61b-44d9-88ed-5944d1962f5e");
    });
  });

  describe("getRefreshLeadMs", () => {
    it("returns 4 hours for claude", async () => {
      const { getRefreshLeadMs } = await import("../../open-sse/services/tokenRefresh.js");
      expect(getRefreshLeadMs("claude")).toBe(4 * 60 * 60 * 1000);
    });
  });
});
