/**
 * Unit tests for in-flight refresh dedup via getAccessToken
 *
 * Verifies that two concurrent callers requesting refresh for the same
 * provider+refreshToken share one upstream fetch call (preventing Auth0
 * refresh_token_reused family revoke).
 *
 * The dedup logic lives in getAccessToken() which uses a module-level
 * refreshPromiseCache Map keyed by `${provider}:${refreshToken}`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalFetch = global.fetch;

describe("In-Flight Refresh Dedup (getAccessToken)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("returns null when no valid refresh token is provided", async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock;
    const { getAccessToken } = await import("../../open-sse/services/tokenRefresh.ts");
    // Note: after import, proxyFetch replaces global.fetch with patchedFetch.
    // We assert on fetchMock (captured before import) instead.

    const result = await getAccessToken("codex", null, null);
    expect(result).toBeNull();

    const result2 = await getAccessToken("codex", {}, null);
    expect(result2).toBeNull();

    const result3 = await getAccessToken("codex", { refreshToken: 123 }, null);
    expect(result3).toBeNull();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("deduplicates concurrent calls for same provider+refreshToken (one upstream fetch)", async () => {
    let resolveFetch;
    const delayedPromise = new Promise((resolve) => {
      resolveFetch = resolve;
    });

    global.fetch = vi.fn().mockReturnValue(delayedPromise);

    const { getAccessToken } = await import("../../open-sse/services/tokenRefresh.ts");

    const creds = { refreshToken: "dedup-test-token" };

    // Start two parallel calls before the first resolves
    const promise1 = getAccessToken("codex", creds, null);
    const promise2 = getAccessToken("codex", creds, null);

    // Resolve the shared fetch
    resolveFetch({
      ok: true,
      json: () =>
        Promise.resolve({
          access_token: "deduped-token",
          refresh_token: "deduped-refresh",
          expires_in: 3600,
        }),
    });

    const [r1, r2] = await Promise.all([promise1, promise2]);

    // Only one fetch call should have been made
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(r1.accessToken).toBe("deduped-token");
    expect(r2.accessToken).toBe("deduped-token");
    expect(r1.refreshToken).toBe("deduped-refresh");
    expect(r2.refreshToken).toBe("deduped-refresh");
  });

  it("does not deduplicate calls for different refresh tokens", async () => {
    let resolve1, resolve2;
    const p1 = new Promise((resolve) => {
      resolve1 = resolve;
    });
    const p2 = new Promise((resolve) => {
      resolve2 = resolve;
    });

    const fetchMock = vi.fn().mockReturnValueOnce(p1).mockReturnValueOnce(p2);
    global.fetch = fetchMock;

    const { getAccessToken } = await import("../../open-sse/services/tokenRefresh.ts");

    const promiseA = getAccessToken("codex", { refreshToken: "token-a" }, null);
    const promiseB = getAccessToken("codex", { refreshToken: "token-b" }, null);

    resolve1({
      ok: true,
      json: () => Promise.resolve({ access_token: "a-token", expires_in: 3600 }),
    });

    resolve2({
      ok: true,
      json: () => Promise.resolve({ access_token: "b-token", expires_in: 3600 }),
    });

    const [rA, rB] = await Promise.all([promiseA, promiseB]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(rA.accessToken).toBe("a-token");
    expect(rB.accessToken).toBe("b-token");
  });

  it("routes to correct refresh function per provider via getAccessToken", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          access_token: "google-token",
          expires_in: 3600,
        }),
    });

    const { getAccessToken } = await import("../../open-sse/services/tokenRefresh.ts");

    const result = await getAccessToken("gemini", { refreshToken: "rt-g" }, null);

    expect(result.accessToken).toBe("google-token");
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url] = global.fetch.mock.calls[0];
    expect(url).toBe("https://oauth2.googleapis.com/token");
  });

  it("does not route unknown providers (returns null, no fetch)", async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock;
    const { getAccessToken } = await import("../../open-sse/services/tokenRefresh.ts");

    const result = await getAccessToken("unknown-provider", { refreshToken: "some-token" }, null);

    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
