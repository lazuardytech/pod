import { NextResponse } from "next/server";
import { generateShortId, loadState } from "@/lib/tunnel/state.js";
import { checkStrictDashboardAuth } from "@/lib/routeAuth.js";

import { sanitizeError } from "@/lib/sanitizeError.js";
export async function POST(request) {
  try {
    const authResponse = await checkStrictDashboardAuth(request);
    if (authResponse) return authResponse;

    const { startLogin } = await import("@/lib/tunnel/tailscale");
    const shortId = loadState()?.shortId || generateShortId();
    const result = await startLogin(shortId);
    return NextResponse.json(result);
  } catch (error) {
    console.error("Tailscale login error:", error);
    return NextResponse.json({ error: sanitizeError(error) }, { status: 500 });
  }
}
