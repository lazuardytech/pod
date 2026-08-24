/**
 * Unit test: Antigravity prompt-cache harness (mocked fetch).
 * Live Google OAuth lives in tests/live/antigravity-cache.test.ts (`bun run test:live`).
 */
import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ANTIGRAVITY_HEADERS,
  INTERNAL_REQUEST_HEADER,
} from "../../open-sse/config/appConstants.ts";
import { PROVIDERS } from "../../open-sse/config/providers.ts";

const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const MIN_CACHE_TOKENS = 100;
const LONG_TEXT = "You are a careful assistant. Always follow these rules. ".repeat(300).trim();

const FAKE_CONNS = [
  { email: "a@example.com", refreshToken: "rt-a", projectId: "proj-a" },
  { email: "b@example.com", refreshToken: "rt-b", projectId: "proj-b" },
];

type CallAgArgs = {
  accessToken: string;
  projectId: string;
  sessionId: string;
  longText: string;
  userText: string;
};

async function refreshAccessToken(refreshToken: string) {
  const { clientId, clientSecret } = PROVIDERS.antigravity;
  const res = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  if (!res.ok) throw new Error(`refresh failed ${res.status}`);
  const json = (await res.json()) as { access_token?: string };
  return json.access_token;
}

async function callAg({ accessToken, projectId, sessionId, longText, userText }: CallAgArgs) {
  const baseUrl = PROVIDERS.antigravity.baseUrls[0];
  const body = {
    project: projectId,
    model: "gemini-3-flash",
    userAgent: "antigravity",
    requestType: "agent",
    requestId: `agent-${crypto.randomUUID()}`,
    request: {
      systemInstruction: { role: "system", parts: [{ text: longText }] },
      contents: [{ role: "user", parts: [{ text: userText }] }],
      sessionId,
    },
  };
  const res = await fetch(`${baseUrl}/v1internal:generateContent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": ANTIGRAVITY_HEADERS["User-Agent"],
      [INTERNAL_REQUEST_HEADER.name]: INTERNAL_REQUEST_HEADER.value,
      "X-Machine-Session-Id": sessionId,
    },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as {
    response?: { usageMetadata?: Record<string, number> };
    usageMetadata?: Record<string, number>;
  };
  const usage = json?.response?.usageMetadata || json?.usageMetadata || {};
  return {
    status: res.status,
    promptTokens: usage.promptTokenCount || 0,
    cachedTokens: usage.cachedContentTokenCount || 0,
    totalTokens: usage.totalTokenCount || 0,
    raw: json,
  };
}

function installFetchMock() {
  const warmed = new Set<string>();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("oauth2.googleapis.com/token")) {
        return new Response(JSON.stringify({ access_token: "mock-access" }), { status: 200 });
      }
      const rawBody = String(init?.body ?? "{}");
      const parsed = JSON.parse(rawBody) as {
        request?: { systemInstruction?: { parts?: { text?: string }[] } };
      };
      const key = parsed.request?.systemInstruction?.parts?.[0]?.text ?? "";
      const hit = warmed.has(key);
      if (!hit) warmed.add(key);
      return new Response(
        JSON.stringify({
          response: {
            usageMetadata: {
              promptTokenCount: 2000,
              cachedContentTokenCount: hit ? 1024 : 0,
              totalTokenCount: 2100,
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }),
  );
}

describe("Antigravity cache behavior (real API)", () => {
  const conns = FAKE_CONNS;

  beforeEach(() => {
    installFetchMock();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("has at least one active AG connection with refreshToken", () => {
    expect(conns.length).toBeGreaterThan(0);
  });

  it("same sessionId → cache hit on repeated call", async () => {
    const acc = conns[0];
    if (!acc) throw new Error("missing fake connection");
    const token = await refreshAccessToken(acc.refreshToken);
    const sessionId = `test-same-${crypto.randomUUID()}`;

    const r1 = await callAg({
      accessToken: token ?? "",
      projectId: acc.projectId,
      sessionId,
      longText: LONG_TEXT,
      userText: "Reply with OK only.",
    });
    const r2 = await callAg({
      accessToken: token ?? "",
      projectId: acc.projectId,
      sessionId,
      longText: LONG_TEXT,
      userText: "Reply with OK only.",
    });

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r2.cachedTokens).toBeGreaterThanOrEqual(MIN_CACHE_TOKENS);
  });

  it("different sessionId (same account) → cache still hits (session-independent)", async () => {
    const acc = conns[0];
    if (!acc) throw new Error("missing fake connection");
    const token = await refreshAccessToken(acc.refreshToken);

    const r1 = await callAg({
      accessToken: token ?? "",
      projectId: acc.projectId,
      sessionId: `test-diff-a-${crypto.randomUUID()}`,
      longText: LONG_TEXT,
      userText: "Reply with OK only.",
    });
    const r2 = await callAg({
      accessToken: token ?? "",
      projectId: acc.projectId,
      sessionId: `test-diff-b-${crypto.randomUUID()}`,
      longText: LONG_TEXT,
      userText: "Reply with OK only.",
    });

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r2.cachedTokens).toBeGreaterThanOrEqual(MIN_CACHE_TOKENS);
  });

  it("cross-account → cache SHARED (content-based global cache)", async () => {
    const accA = conns[0];
    const accB = conns[1];
    if (!accA || !accB) throw new Error("need two fake connections");
    const [tokenA, tokenB] = await Promise.all([
      refreshAccessToken(accA.refreshToken),
      refreshAccessToken(accB.refreshToken),
    ]);

    const a1 = await callAg({
      accessToken: tokenA ?? "",
      projectId: accA.projectId,
      sessionId: `cross-a-${crypto.randomUUID()}`,
      longText: LONG_TEXT,
      userText: "Reply with OK only.",
    });
    const b1 = await callAg({
      accessToken: tokenB ?? "",
      projectId: accB.projectId,
      sessionId: `cross-b-${crypto.randomUUID()}`,
      longText: LONG_TEXT,
      userText: "Reply with OK only.",
    });

    expect(a1.status).toBe(200);
    expect(b1.status).toBe(200);
    expect(b1.cachedTokens).toBeGreaterThanOrEqual(MIN_CACHE_TOKENS);
  });

  it("codex-style sessionId vs random sessionId on unique prompt", async () => {
    const acc = conns[0];
    if (!acc) throw new Error("missing fake connection");
    const token = await refreshAccessToken(acc.refreshToken);
    const uniqueMarker = crypto.randomUUID();
    const uniqueLong = `MARKER-${uniqueMarker}. ${LONG_TEXT}`;
    const userText = "Reply with OK only.";
    const hash = crypto
      .createHash("sha256")
      .update(uniqueLong + "\n" + userText)
      .digest("hex")
      .slice(0, 32);
    const codexStyleSessionId = `sess_${hash}`;

    const N = 4;
    const randomResults = [];
    const codexResults = [];

    for (let i = 0; i < N; i++) {
      randomResults.push(
        await callAg({
          accessToken: token ?? "",
          projectId: acc.projectId,
          sessionId: `rand-${crypto.randomUUID()}`,
          longText: uniqueLong,
          userText,
        }),
      );
    }
    for (let i = 0; i < N; i++) {
      codexResults.push(
        await callAg({
          accessToken: token ?? "",
          projectId: acc.projectId,
          sessionId: codexStyleSessionId,
          longText: uniqueLong,
          userText,
        }),
      );
    }

    randomResults.forEach((r) => expect(r.status).toBe(200));
    codexResults.forEach((r) => expect(r.status).toBe(200));
    expect(randomResults[0]?.cachedTokens).toBe(0);
    expect(randomResults.slice(1).every((r) => r.cachedTokens >= MIN_CACHE_TOKENS)).toBe(true);
    expect(codexResults.every((r) => r.cachedTokens >= MIN_CACHE_TOKENS)).toBe(true);
  });

  it("unique prompt (never seen) → explore when cache starts hitting", async () => {
    const acc = conns[0];
    if (!acc) throw new Error("missing fake connection");
    const token = await refreshAccessToken(acc.refreshToken);
    const uniqueLong = `UNIQUE-${crypto.randomUUID()}. ${LONG_TEXT}`;
    const sessionId = `unique-${crypto.randomUUID()}`;

    const results = [];
    for (let i = 0; i < 5; i++) {
      results.push(
        await callAg({
          accessToken: token ?? "",
          projectId: acc.projectId,
          sessionId,
          longText: uniqueLong,
          userText: "Reply with OK only.",
        }),
      );
    }

    results.forEach((r) => expect(r.status).toBe(200));
    expect(results[0]?.cachedTokens).toBe(0);
    expect(results.slice(1).every((r) => r.cachedTokens >= MIN_CACHE_TOKENS)).toBe(true);
  });
});
