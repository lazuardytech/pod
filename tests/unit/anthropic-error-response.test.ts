/**
 * Unit tests for the Anthropic-compatible error response factory
 * (src/lib/anthropicError.ts), used by /v1/messages and its count_tokens
 * route. Error type mapping must stay aligned with the official Anthropic
 * error taxonomy — any drift is a compatibility regression.
 */

import { describe, expect, it } from "vitest";

import { anthropicErrorResponse } from "@/lib/anthropicError";

describe("anthropicErrorResponse", () => {
  it.each([
    [400, "invalid_request_error"],
    [401, "authentication_error"],
    [402, "billing_error"],
    [403, "permission_error"],
    [404, "not_found_error"],
    [429, "rate_limit_error"],
    [500, "api_error"],
    [502, "api_error"],
    [503, "overloaded_error"],
    [504, "timeout_error"],
  ] as const)("maps status %i to %s", async (status, expectedType) => {
    const res = anthropicErrorResponse(status, "something broke");
    expect(res.status).toBe(status);
    const body = await res.json();
    expect(body).toEqual({
      type: "error",
      error: { type: expectedType, message: "something broke" },
    });
  });

  it("falls back to api_error for unmapped statuses", async () => {
    const res = anthropicErrorResponse(418, "teapot");
    const body = await res.json();
    expect(body.error.type).toBe("api_error");
  });

  it("sets anthropic-version and CORS headers", () => {
    const res = anthropicErrorResponse(429, "slow down");
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("anthropic-version")).toBe("2023-06-01");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-methods")).toContain("POST");
  });
});
