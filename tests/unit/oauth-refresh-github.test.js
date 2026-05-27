/**
 * Unit tests for GitHub OAuth token refresh
 *
 * Verifies:
 * - GitHub OAuth token refresh (refreshGitHubToken)
 * - GitHub Copilot token refresh (refreshCopilotToken)
 * - Token rotation, 401/network error handling
 * - Lead time (default 5 min buffer)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalFetch = global.fetch;

describe("GitHub OAuth Token Refresh", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe("refreshGitHubToken", () => {
    it("returns new access_token and rotated refresh_token on success", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: "new-gh-access",
            refresh_token: "rotated-gh-refresh",
            expires_in: 28800,
          }),
      });

      const { refreshGitHubToken } = await import("../../open-sse/services/tokenRefresh.js");
      const result = await refreshGitHubToken("old-refresh", null);

      expect(result.accessToken).toBe("new-gh-access");
      expect(result.refreshToken).toBe("rotated-gh-refresh");
      expect(result.expiresIn).toBe(28800);
    });

    it("keeps old refresh_token when server does not return a new one", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: "another-gh-access",
            expires_in: 28800,
          }),
      });

      const { refreshGitHubToken } = await import("../../open-sse/services/tokenRefresh.js");
      const result = await refreshGitHubToken("original-refresh", null);

      expect(result.refreshToken).toBe("original-refresh");
    });

    it("returns null on 401", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve('{"error":"bad_verification_code"}'),
      });

      const { refreshGitHubToken } = await import("../../open-sse/services/tokenRefresh.js");
      const result = await refreshGitHubToken("bad-token", null);

      expect(result).toBeNull();
    });

    it("returns null on network error", async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error("DNS lookup failed"));

      const { refreshGitHubToken } = await import("../../open-sse/services/tokenRefresh.js");
      const result = await refreshGitHubToken("some-token", null);

      expect(result).toBeNull();
    });

    it("sends form-encoded payload to github token endpoint", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: "tok",
            expires_in: 28800,
          }),
      });
      global.fetch = fetchMock;

      const { refreshGitHubToken } = await import("../../open-sse/services/tokenRefresh.js");
      await refreshGitHubToken("rt-github", null);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toBe("https://github.com/login/oauth/access_token");
      expect(opts.method).toBe("POST");
      expect(opts.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
      const body = new URLSearchParams(opts.body);
      expect(body.get("grant_type")).toBe("refresh_token");
      expect(body.get("refresh_token")).toBe("rt-github");
    });
  });

  describe("refreshCopilotToken", () => {
    it("returns token and expiresAt on success", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            token: "copilot-token-value",
            expires_at: 1893456000,
          }),
      });

      const { refreshCopilotToken } = await import("../../open-sse/services/tokenRefresh.js");
      const result = await refreshCopilotToken("gh-access-token", null);

      expect(result.token).toBe("copilot-token-value");
      expect(result.expiresAt).toBe(1893456000);
    });

    it("returns null on 401", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve("Bad credentials"),
      });

      const { refreshCopilotToken } = await import("../../open-sse/services/tokenRefresh.js");
      const result = await refreshCopilotToken("bad-token", null);

      expect(result).toBeNull();
    });

    it("returns null on network error", async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error("network timeout"));

      const { refreshCopilotToken } = await import("../../open-sse/services/tokenRefresh.js");
      const result = await refreshCopilotToken("some-token", null);

      expect(result).toBeNull();
    });
  });

  describe("getRefreshLeadMs", () => {
    it("returns default buffer for github (no custom lead)", async () => {
      const { getRefreshLeadMs, TOKEN_EXPIRY_BUFFER_MS } = await import("../../open-sse/services/tokenRefresh.js");

      expect(getRefreshLeadMs("github")).toBe(TOKEN_EXPIRY_BUFFER_MS);
    });
  });
});
