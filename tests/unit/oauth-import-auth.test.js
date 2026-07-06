import { beforeEach, describe, expect, it, vi } from "vitest";

const unauthorizedResponse = {
  status: 401,
  body: { error: "Unauthorized" },
  json: async () => ({ error: "Unauthorized" }),
};

const checkStrictDashboardAuthMock = vi.fn();
vi.mock("@/lib/routeAuth.js", () => ({
  checkStrictDashboardAuth: checkStrictDashboardAuthMock,
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json: vi.fn((body, init) => ({
      status: init?.status || 200,
      body,
      json: async () => body,
    })),
  },
}));

function createRequest(url = "http://localhost/test") {
  return {
    url,
    headers: { get: vi.fn(() => null) },
    cookies: { get: vi.fn(() => undefined) },
    json: vi.fn(async () => ({})),
  };
}

describe("OAuth import helper auth gates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checkStrictDashboardAuthMock.mockResolvedValue(unauthorizedResponse);
  });

  it("short-circuits Cursor import GET/POST when auth fails", async () => {
    const { GET, POST } = await import("@/app/api/oauth/cursor/import/route.js");

    const getResponse = await GET(createRequest("http://localhost/api/oauth/cursor/import"));
    const postResponse = await POST(createRequest("http://localhost/api/oauth/cursor/import"));

    expect(getResponse).toBe(unauthorizedResponse);
    expect(postResponse).toBe(unauthorizedResponse);
  });

  it("short-circuits Kiro auto-import and import when auth fails", async () => {
    const autoImport = await import("@/app/api/oauth/kiro/auto-import/route.js");
    const importRoute = await import("@/app/api/oauth/kiro/import/route.js");

    const autoResponse = await autoImport.GET(
      createRequest("http://localhost/api/oauth/kiro/auto-import"),
    );
    const importResponse = await importRoute.POST(
      createRequest("http://localhost/api/oauth/kiro/import"),
    );

    expect(autoResponse).toBe(unauthorizedResponse);
    expect(importResponse).toBe(unauthorizedResponse);
  });

  it("short-circuits Kiro social authorize/exchange when auth fails", async () => {
    const authorize = await import("@/app/api/oauth/kiro/social-authorize/route.js");
    const exchange = await import("@/app/api/oauth/kiro/social-exchange/route.js");

    const authorizeResponse = await authorize.GET(
      createRequest("http://localhost/api/oauth/kiro/social-authorize?provider=google"),
    );
    const exchangeResponse = await exchange.POST(
      createRequest("http://localhost/api/oauth/kiro/social-exchange"),
    );

    expect(authorizeResponse).toBe(unauthorizedResponse);
    expect(exchangeResponse).toBe(unauthorizedResponse);
  });

  it("short-circuits GitLab PAT and iFlow cookie helpers when auth fails", async () => {
    const gitlabPat = await import("@/app/api/oauth/gitlab/pat/route.js");
    const iflowCookie = await import("@/app/api/oauth/iflow/cookie/route.js");

    const gitlabResponse = await gitlabPat.POST(
      createRequest("http://localhost/api/oauth/gitlab/pat"),
    );
    const iflowResponse = await iflowCookie.POST(
      createRequest("http://localhost/api/oauth/iflow/cookie"),
    );

    expect(gitlabResponse).toBe(unauthorizedResponse);
    expect(iflowResponse).toBe(unauthorizedResponse);
  });

  it("short-circuits generic OAuth authorize/exchange routes when auth fails", async () => {
    const oauthRoute = await import("@/app/api/oauth/[provider]/[action]/route.js");

    const authorizeResponse = await oauthRoute.GET(
      createRequest(
        "http://localhost/api/oauth/github/authorize?redirect_uri=http://localhost/callback",
      ),
      { params: Promise.resolve({ provider: "github", action: "authorize" }) },
    );
    const exchangeResponse = await oauthRoute.POST(
      createRequest("http://localhost/api/oauth/github/exchange"),
      {
        params: Promise.resolve({ provider: "github", action: "exchange" }),
      },
    );

    expect(authorizeResponse).toBe(unauthorizedResponse);
    expect(exchangeResponse).toBe(unauthorizedResponse);
  });
});
