import { NextResponse } from "next/server";
import { loadSettingsSafe } from "@/lib/routeAuth";
import { hasValidToken } from "@/lib/routeAuth";

/**
 * Public auth status read for the dashboard client gate.
 * The auth_token cookie is HttpOnly, so the browser JS cannot see it — this
 * endpoint is the only way for the client to learn whether the user is
 * authenticated. Returns booleans only; no sensitive payload.
 */
export async function GET(request: Request) {
  const [authenticated, settings] = await Promise.all([hasValidToken(request), loadSettingsSafe()]);
  return NextResponse.json({
    authenticated,
    requireLogin: settings ? settings.requireLogin !== false : true,
  });
}
