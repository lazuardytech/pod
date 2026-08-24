/**
 * Unit tests for Kiro (AWS CodeWhisperer) OAuth token refresh
 *
 * Kiro has two auth paths:
 * 1. AWS SSO OIDC (Builder ID / IDC) — uses proxyAwareFetch with clientId/clientSecret
 * 2. Social Auth (Google/GitHub) — uses proxyAwareFetch to kiro refresh endpoint
 *
 * Verifies:
 * - AWS SSO OIDC successful refresh + token rotation
 * - AWS SSO OIDC with IDC region
 * - Social auth successful refresh + error handling
 * - Network errors
 * - Lead time (default 5 min)
 *
 * Note: refreshKiroToken uses proxyAwareFetch internally. We mock global.fetch
 * before module import so proxyFetch's originalFetch captures our mock.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Kiro OAuth Token Refresh", () => {
  let fetchMock;
  let refreshKiroToken;

  beforeAll(async () => {
    fetchMock = vi.fn();
    global.fetch = fetchMock;
    const mod = await import("../../open-sse/services/tokenRefresh.ts");
    refreshKiroToken = mod.refreshKiroToken;
  });

  afterAll(() => {
    vi.clearAllMocks();
  });

  beforeEach(() => {
    fetchMock.mockReset();
  });

  describe("AWS SSO OIDC path (Builder ID)", () => {
    it("returns new accessToken and rotated refreshToken on success", async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            accessToken: "new-kiro-aws-access",
            refreshToken: "rotated-kiro-refresh",
            expiresIn: 3600,
          }),
      });

      const result = await refreshKiroToken(
        "old-refresh",
        { clientId: "test-client", clientSecret: "test-secret" },
        null,
      );

      expect(result.accessToken).toBe("new-kiro-aws-access");
      expect(result.refreshToken).toBe("rotated-kiro-refresh");
      expect(result.expiresIn).toBe(3600);
    });

    it("keeps old refreshToken when server does not return a new one", async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            accessToken: "another-kiro-token",
            expiresIn: 3600,
          }),
      });

      const result = await refreshKiroToken(
        "original-refresh",
        { clientId: "test-client", clientSecret: "test-secret" },
        null,
      );

      expect(result.refreshToken).toBe("original-refresh");
    });

    it("sends correct AWS SSO OIDC endpoint and JSON body", async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            accessToken: "tok",
            expiresIn: 3600,
          }),
      });

      await refreshKiroToken("rt-aws", { clientId: "cid", clientSecret: "csecret" }, null);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toBe("https://oidc.us-east-1.amazonaws.com/token");
      expect(opts.method).toBe("POST");
      expect(opts.headers["Content-Type"]).toBe("application/json");
      const body = JSON.parse(opts.body);
      expect(body.clientId).toBe("cid");
      expect(body.clientSecret).toBe("csecret");
      expect(body.refreshToken).toBe("rt-aws");
      expect(body.grantType).toBe("refresh_token");
    });

    it("returns null on network error for AWS OIDC path", async () => {
      fetchMock.mockRejectedValue(new Error("AWS OIDC timeout"));

      const result = await refreshKiroToken(
        "some-token",
        { clientId: "cid", clientSecret: "csecret" },
        null,
      );

      expect(result).toBeNull();
    });
  });

  describe("AWS SSO OIDC — IDC with region", () => {
    it("uses regional endpoint when authMethod is idc and region is provided", async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            accessToken: "idc-token",
            expiresIn: 3600,
          }),
      });

      await refreshKiroToken(
        "rt-idc",
        { clientId: "cid", clientSecret: "csecret", authMethod: "idc", region: "eu-west-1" },
        null,
      );

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url] = fetchMock.mock.calls[0];
      expect(url).toBe("https://oidc.eu-west-1.amazonaws.com/token");
    });

    it("falls back to us-east-1 when idc region is not provided", async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            accessToken: "idc-token",
            expiresIn: 3600,
          }),
      });

      await refreshKiroToken(
        "rt-idc",
        { clientId: "cid", clientSecret: "csecret", authMethod: "idc" },
        null,
      );

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url] = fetchMock.mock.calls[0];
      expect(url).toBe("https://oidc.us-east-1.amazonaws.com/token");
    });
  });

  describe("Social Auth path", () => {
    it("returns new accessToken and refreshToken on success", async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            accessToken: "social-access",
            refreshToken: "social-refresh",
            expiresIn: 3600,
          }),
      });

      const result = await refreshKiroToken("old-social-refresh", {}, null);

      expect(result.accessToken).toBe("social-access");
      expect(result.refreshToken).toBe("social-refresh");
    });

    it("returns null on 401 for social auth", async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve("Unauthorized"),
      });

      const result = await refreshKiroToken("bad-social-token", {}, null);

      expect(result).toBeNull();
    });
  });

  describe("getRefreshLeadMs", () => {
    it("returns default buffer for kiro (no custom lead)", async () => {
      const { getRefreshLeadMs, TOKEN_EXPIRY_BUFFER_MS } =
        await import("../../open-sse/services/tokenRefresh.ts");

      expect(getRefreshLeadMs("kiro")).toBe(TOKEN_EXPIRY_BUFFER_MS);
    });
  });
});
