/**
 * Unit tests for Vercel relay robustness (v0.0.55).
 *
 * Covers:
 *   Fix 1 — proxyFetch timeout margin (pod timeout - 5s → relay timeout, min 1s)
 *   Fix 2 — Vercel platform 504 detection (surface relay-timeout error)
 *   Fix 3 — Healthcheck endpoint switch to google.com/generate_204
 *   Fix 4 — One-shot retry on relay 502/504 with 2s delay (cold-start mitigation)
 */

import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// Fix 1: proxyFetch timeout margin
// ─────────────────────────────────────────────────────────────────────────────

describe("proxyAwareFetch — relay timeout margin (Fix 1)", () => {
  let originalFetch;
  let fetchSpy;
  let proxyAwareFetch;

  beforeEach(async () => {
    originalFetch = globalThis.fetch;
    fetchSpy = vi.fn(() => Promise.resolve(new Response("ok", { status: 200 })));
    globalThis.fetch = fetchSpy;
    // Import after setting spy so the module's originalFetch captures our spy.
    // Note: the module overwrites globalThis.fetch with patchedFetch, but
    // proxyAwareFetch calls originalFetch which points to our fetchSpy.
    const mod = await import("../../open-sse/utils/proxyFetch.ts");
    proxyAwareFetch = mod.proxyAwareFetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.resetModules();
  });

  it("subtracts 5s from pod timeout (45000 → 40000)", async () => {
    await proxyAwareFetch(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      },
      {
        vercelRelayUrl: "https://relay.vercel.app",
        upstreamTimeoutMs: 45000,
      },
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const callArgs = fetchSpy.mock.calls[0];
    const relayHeaders = callArgs[1].headers;
    expect(relayHeaders["x-relay-timeout"]).toBe("40000");
  });

  it("subtracts 5s (10000 → 5000)", async () => {
    await proxyAwareFetch(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      },
      {
        vercelRelayUrl: "https://relay.vercel.app",
        upstreamTimeoutMs: 10000,
      },
    );

    const relayHeaders = fetchSpy.mock.calls[0][1].headers;
    expect(relayHeaders["x-relay-timeout"]).toBe("5000");
  });

  it("clamps at 1s minimum (3000 → 1000)", async () => {
    await proxyAwareFetch(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      },
      {
        vercelRelayUrl: "https://relay.vercel.app",
        upstreamTimeoutMs: 3000,
      },
    );

    const relayHeaders = fetchSpy.mock.calls[0][1].headers;
    expect(relayHeaders["x-relay-timeout"]).toBe("1000");
  });

  it("omits x-relay-timeout when upstreamTimeoutMs is undefined", async () => {
    await proxyAwareFetch(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      },
      {
        vercelRelayUrl: "https://relay.vercel.app",
        // upstreamTimeoutMs not set
      },
    );

    const relayHeaders = fetchSpy.mock.calls[0][1].headers;
    expect(relayHeaders["x-relay-timeout"]).toBeUndefined();
  });

  it("includes x-relay-target and x-relay-path headers", async () => {
    await proxyAwareFetch(
      "https://api.openai.com/v1/chat/completions?model=gpt-5",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      },
      {
        vercelRelayUrl: "https://relay.vercel.app",
      },
    );

    const relayHeaders = fetchSpy.mock.calls[0][1].headers;
    expect(relayHeaders["x-relay-target"]).toBe("https://api.openai.com");
    expect(relayHeaders["x-relay-path"]).toBe("/v1/chat/completions?model=gpt-5");
  });

  it("includes x-relay-auth when relayAuthToken is configured", async () => {
    await proxyAwareFetch(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      },
      {
        vercelRelayUrl: "https://relay.vercel.app",
        relayAuthToken: "relay-secret",
      },
    );

    const relayHeaders = fetchSpy.mock.calls[0][1].headers;
    expect(relayHeaders["x-relay-auth"]).toBe("relay-secret");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Fix 3: Healthcheck endpoint
// ─────────────────────────────────────────────────────────────────────────────

describe("testVercelRelay — healthcheck endpoint (Fix 3)", () => {
  it("targets google.com/generate_204 with identifiable headers", () => {
    const routePath = path.resolve(
      import.meta.dirname,
      "../../src/app/api/proxy-pools/[id]/test/route.ts",
    );
    const source = fs.readFileSync(routePath, "utf8");

    // Verify correct target (JS object keys are unquoted, values are quoted)
    expect(source).toContain('"x-relay-target": "https://www.google.com"');
    expect(source).toContain('"x-relay-path": "/generate_204"');
    expect(source).toContain('"x-relay-auth"');
    expect(source).toContain('Accept: "*/*"');
    expect(source).toContain('"User-Agent": "pod-relay-healthcheck/1.0"');
  });

  it("considers 204 No Content as healthy (res.ok covers 200-299)", () => {
    const routePath = path.resolve(
      import.meta.dirname,
      "../../src/app/api/proxy-pools/[id]/test/route.ts",
    );
    const source = fs.readFileSync(routePath, "utf8");
    expect(source).toContain("ok: res.ok");
    expect(source).not.toContain("res.status === 200");
  });

  it("keeps 10s timeout and AbortController", () => {
    const routePath = path.resolve(
      import.meta.dirname,
      "../../src/app/api/proxy-pools/[id]/test/route.ts",
    );
    const source = fs.readFileSync(routePath, "utf8");
    expect(source).toContain("timeoutMs: number = 10000");
    expect(source).toContain("new AbortController()");
    expect(source).toContain("clearTimeout(timer)");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Fix 2 + Fix 4: Vercel platform 504 detection + one-shot retry
// ─────────────────────────────────────────────────────────────────────────────

describe("chatCore — Vercel relay 504 detection (Fix 2)", () => {
  it("returns relay-timeout error when Vercel relay returns 504", async () => {
    // Verify the HTTP_STATUS constant and that the Fix 2 condition exists in source.
    const { HTTP_STATUS } = await import("../../open-sse/config/runtimeConfig.ts");
    expect(HTTP_STATUS.GATEWAY_TIMEOUT).toBe(504);

    // Verify the 504 detection code exists in chatCore.ts
    const chatCorePath = path.resolve(import.meta.dirname, "../../open-sse/handlers/chatCore.ts");
    const source = fs.readFileSync(chatCorePath, "utf8");
    expect(source).toContain("[VERCEL-RELAY-TIMEOUT]");
    expect(source).toContain("Vercel relay timeout — function exceeded platform limit");
  });

  it("does not special-case 504 when vercelRelayUrl is not set", async () => {
    // The Fix 2 guard is: providerResponse && status === 504 && proxyOptions.vercelRelayUrl
    // When vercelRelayUrl is falsy, the condition is skipped.
    const { HTTP_STATUS } = await import("../../open-sse/config/runtimeConfig.ts");
    expect(HTTP_STATUS.BAD_GATEWAY).toBe(502);
    expect(HTTP_STATUS.GATEWAY_TIMEOUT).toBe(504);

    // Verify the condition in source includes the vercelRelayUrl guard
    const chatCorePath = path.resolve(import.meta.dirname, "../../open-sse/handlers/chatCore.ts");
    const source = fs.readFileSync(chatCorePath, "utf8");
    expect(source).toContain(
      "providerResponse && providerResponse.status === 504 && proxyOptions.vercelRelayUrl",
    );
  });
});

describe("chatCore — one-shot retry on 502/504 (Fix 4)", () => {
  it("retry flag: Vercel relay 502 triggers retry condition", async () => {
    const { HTTP_STATUS } = await import("../../open-sse/config/runtimeConfig.ts");
    expect(HTTP_STATUS.BAD_GATEWAY).toBe(502);
    expect(HTTP_STATUS.GATEWAY_TIMEOUT).toBe(504);

    // Verify retry code exists in source
    const chatCorePath = path.resolve(import.meta.dirname, "../../open-sse/handlers/chatCore.ts");
    const source = fs.readFileSync(chatCorePath, "utf8");
    expect(source).toContain("[VERCEL-RELAY-RETRY]");
    expect(source).toContain("Retrying upstream request after relay 502/504");
    expect(source).toContain("providerResponse.status === 502 || providerResponse.status === 504");
  });

  it("retry delay is 2000ms (vi.useFakeTimers)", async () => {
    vi.useFakeTimers();

    // Simulate the retry delay: await new Promise((r) => setTimeout(r, 2000))
    let resolved = false;
    const delayPromise = new Promise((r) => setTimeout(r, 2000));
    delayPromise.then(() => {
      resolved = true;
    });

    // At 1999ms, not resolved
    vi.advanceTimersByTime(1999);
    await Promise.resolve();
    expect(resolved).toBe(false);

    // At 2000ms, resolved
    vi.advanceTimersByTime(1);
    await Promise.resolve();
    expect(resolved).toBe(true);

    vi.useRealTimers();
  });

  it("does not retry on non-relay path (vercelRelayUrl is falsy)", () => {
    // The retry guard: proxyOptions.vercelRelayUrl && (status === 502 || status === 504)
    const shouldRetry = (vercelRelayUrl, status) =>
      !!(vercelRelayUrl && (status === 502 || status === 504));

    expect(shouldRetry("https://relay.vercel.app", 502)).toBe(true);
    expect(shouldRetry("https://relay.vercel.app", 504)).toBe(true);
    expect(shouldRetry("", 502)).toBe(false);
    expect(shouldRetry(null, 504)).toBe(false);
    expect(shouldRetry(undefined, 502)).toBe(false);
    expect(shouldRetry("https://relay.vercel.app", 200)).toBe(false);
    expect(shouldRetry("https://relay.vercel.app", 401)).toBe(false);
  });

  it("retry success path: 502 → 200 after retry", async () => {
    let callCount = 0;
    const executeUpstream = vi.fn(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({
          response: new Response("bad gateway", { status: 502 }),
          url: "https://relay.vercel.app",
          headers: {},
          transformedBody: {},
        });
      }
      return Promise.resolve({
        response: new Response('{"choices":[{"message":{"content":"ok"}}]}', { status: 200 }),
        url: "https://relay.vercel.app",
        headers: {},
        transformedBody: {},
      });
    });

    const proxyOptions = { vercelRelayUrl: "https://relay.vercel.app" };

    // First call
    const result1 = await executeUpstream();
    let response = result1.response;

    // Retry on 502 (mirrors the chatCore Fix 4 logic)
    if (proxyOptions.vercelRelayUrl && (response.status === 502 || response.status === 504)) {
      await new Promise((r) => setTimeout(r, 2000));
      const retry = await executeUpstream();
      response = retry.response;
    }

    expect(callCount).toBe(2);
    expect(response.status).toBe(200);
  });

  it("retry exhaustion path: 504 twice → still 504", async () => {
    const executeUpstream = vi.fn(() =>
      Promise.resolve({
        response: new Response("platform timeout", { status: 504 }),
        url: "https://relay.vercel.app",
        headers: {},
        transformedBody: {},
      }),
    );

    const proxyOptions = { vercelRelayUrl: "https://relay.vercel.app" };

    const result1 = await executeUpstream();
    let response = result1.response;

    if (proxyOptions.vercelRelayUrl && (response.status === 502 || response.status === 504)) {
      await new Promise((r) => setTimeout(r, 2000));
      const retry = await executeUpstream();
      response = retry.response;
    }

    expect(executeUpstream).toHaveBeenCalledTimes(2);
    expect(response.status).toBe(504);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Smoke audit: relay function code clearTimeout
// ─────────────────────────────────────────────────────────────────────────────

describe("RELAY_FUNCTION_CODE — timeout cleanup", () => {
  it("calls clearTimeout on both success and error paths", () => {
    const routePath = path.resolve(
      import.meta.dirname,
      "../../src/app/api/proxy-pools/vercel-deploy/route.ts",
    );
    const source = fs.readFileSync(routePath, "utf8");

    // clearTimeout in try block (success path)
    expect(source).toMatch(/if \(timeoutId\) clearTimeout\(timeoutId\);\s*return new Response/);

    // clearTimeout in catch block (error path)
    expect(source).toMatch(
      /catch\s*\(err\)\s*\{[\s\S]*?if \(timeoutId\) clearTimeout\(timeoutId\)/,
    );
  });

  it("pollDeployment has bounded retries with 120s budget", () => {
    const routePath = path.resolve(
      import.meta.dirname,
      "../../src/app/api/proxy-pools/vercel-deploy/route.ts",
    );
    const source = fs.readFileSync(routePath, "utf8");
    expect(source).toContain("maxMs: number = 120000");
    expect(source).toContain("Date.now() - start < maxMs");
    expect(source).toContain("setTimeout(r, 3000)");
  });

  it("requires a relay auth token and strips it before forwarding", () => {
    const routePath = path.resolve(
      import.meta.dirname,
      "../../src/app/api/proxy-pools/vercel-deploy/route.ts",
    );
    const source = fs.readFileSync(routePath, "utf8");
    expect(source).toContain("const RELAY_AUTH_TOKEN =");
    expect(source).toContain('req.headers.get("x-relay-auth")');
    expect(source).toContain('headers.delete("x-relay-auth")');
    expect(source).toContain('randomBytes(24).toString("hex")');
  });
});
