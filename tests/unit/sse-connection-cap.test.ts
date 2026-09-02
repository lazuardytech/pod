/**
 * Unit tests for the shared SSE connection cap
 * (src/app/api/monitoring/_sseConnectionCap.ts).
 *
 * Enforces the 100-concurrent-connection ceiling on SSE endpoints with a
 * 503 + Retry-After overload response, per route path.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_MAX_CONCURRENT,
  releaseSSESlot,
  tryAcquireSSESlot,
} from "@/app/api/monitoring/_sseConnectionCap";

describe("SSE connection cap", () => {
  beforeEach(() => {
    releaseAllSlots("/api/monitoring/health/stream");
    releaseAllSlots("/api/other/stream");
  });

  afterEach(() => {
    releaseAllSlots("/api/monitoring/health/stream");
    releaseAllSlots("/api/other/stream");
  });

  function releaseAllSlots(routePath: string) {
    // Drain the module-level counter back to zero across tests. No test
    // acquires more than the cap, so draining cap times always resets it.
    for (let i = 0; i < DEFAULT_MAX_CONCURRENT; i++) {
      releaseSSESlot(routePath);
    }
  }

  it(`allows up to ${DEFAULT_MAX_CONCURRENT} concurrent connections`, () => {
    for (let i = 0; i < DEFAULT_MAX_CONCURRENT; i++) {
      expect(tryAcquireSSESlot("/api/monitoring/health/stream").allowed).toBe(true);
    }
  });

  it(`rejects the ${DEFAULT_MAX_CONCURRENT + 1}st connection with a 503 overload response`, async () => {
    for (let i = 0; i < DEFAULT_MAX_CONCURRENT; i++) {
      tryAcquireSSESlot("/api/monitoring/health/stream");
    }

    const result = tryAcquireSSESlot("/api/monitoring/health/stream");
    expect(result.allowed).toBe(false);
    const res = result.response!;
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("10");
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(JSON.parse(await res.text())).toEqual({
      error: "Too many connections",
      type: "overload_error",
    });
  });

  it("frees a slot when released", () => {
    for (let i = 0; i < DEFAULT_MAX_CONCURRENT; i++) {
      tryAcquireSSESlot("/api/monitoring/health/stream");
    }
    expect(tryAcquireSSESlot("/api/monitoring/health/stream").allowed).toBe(false);

    releaseSSESlot("/api/monitoring/health/stream");
    expect(tryAcquireSSESlot("/api/monitoring/health/stream").allowed).toBe(true);
  });

  it("tracks slots per route path", () => {
    for (let i = 0; i < DEFAULT_MAX_CONCURRENT; i++) {
      tryAcquireSSESlot("/api/monitoring/health/stream");
    }

    expect(tryAcquireSSESlot("/api/other/stream").allowed).toBe(true);
  });

  it("tolerates releasing past zero", () => {
    expect(() => releaseSSESlot("/api/unknown/stream")).not.toThrow();
    expect(tryAcquireSSESlot("/api/unknown/stream").allowed).toBe(true);
  });
});
