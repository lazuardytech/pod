import { jwtVerify } from "jose";
import { NextResponse } from "next/server";
import { getSettings, validateApiKey } from "@/lib/localDb";
import { extractApiKey } from "@/sse/services/auth";

const SECRET = new TextEncoder().encode(process.env.JWT_SECRET || "pod-default-secret-change-me");

/**
 * Verify a request can access monitoring endpoints.
 *
 * Auth precedence:
 *   1. If `requireApiKey === false` AND `requireLogin === false` → public.
 *   2. Bearer / x-api-key header with a valid API key → allow.
 *   3. Dashboard JWT cookie `auth_token` (set by /api/auth/login) → allow.
 *      This is what makes the in-app /health page work without exposing the API key
 *      in the browser bundle.
 *   4. Otherwise → null (caller should return 401).
 *
 * Returns null on success, or a NextResponse 401 to short-circuit the handler.
 *
 * @param {Request} request
 * @returns {Promise<NextResponse | null>}
 */
export async function checkMonitoringAuth(request) {
  let settings;
  try {
    settings = await getSettings();
  } catch {
    settings = {};
  }

  const requireApiKey = settings.requireApiKey === true;
  const requireLogin = settings.requireLogin !== false;

  // No auth required at all — public access.
  if (!requireApiKey && !requireLogin) return null;

  // Defensive: if no request was passed (legacy callers, tests), treat as
  // unauthorized when any auth is required. The header/cookie checks below
  // would otherwise crash on undefined.
  if (!request || typeof request.headers?.get !== "function") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Try Bearer / x-api-key header first.
  const apiKey = extractApiKey(request);
  if (apiKey) {
    try {
      const valid = await validateApiKey(apiKey);
      if (valid) return null;
    } catch {
      // fall through to cookie check
    }
  }

  // Fall back to dashboard JWT cookie. The /health page is rendered behind the
  // dashboard guard, so the same cookie that authenticates the dashboard route
  // should authenticate its embedded API calls.
  const token = request.cookies?.get?.("auth_token")?.value;
  if (token) {
    try {
      await jwtVerify(token, SECRET);
      return null;
    } catch {
      // invalid token, fall through
    }
  }

  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
