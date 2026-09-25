import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SignJWT } from "jose";
import { setupHarness, teardownHarness } from "../helpers/apiRouteHarness.ts";

process.env.JWT_SECRET = "test-session-secret";

describe("GET /api/auth/session — dashboard client auth gate", () => {
  // One DB per file: the harness teardown closes the SQLite handle, and the
  // connection singleton in localDb does not reset — per-test teardown breaks
  // the next setup. Test order is self-consistent (default → token → disabled).
  beforeAll(async () => {
    await setupHarness();
  });

  afterAll(async () => {
    await teardownHarness();
  });

  it("reports unauthenticated with requireLogin true by default (no cookie)", async () => {
    const { GET } = await import("@/app/api/auth/session/route");
    const res = await GET(new Request("http://localhost/api/auth/session"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({ authenticated: false, requireLogin: true });
  });

  it("reports authenticated for a valid JWT auth_token cookie", async () => {
    const { GET } = await import("@/app/api/auth/session/route");
    const token = await new SignJWT({ authenticated: true })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode(process.env.JWT_SECRET));
    const req = {
      cookies: { get: (name: string) => (name === "auth_token" ? { value: token } : undefined) },
    } as unknown as Request;
    const res = await GET(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.authenticated).toBe(true);
  });

  it("stays unauthenticated when login is disabled (requireLogin false)", async () => {
    const { updateSettings } = await import("@/lib/localDb");
    await updateSettings({ requireLogin: false });
    const { GET } = await import("@/app/api/auth/session/route");
    const res = await GET(new Request("http://localhost/api/auth/session"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({ authenticated: false, requireLogin: false });
  });
});
