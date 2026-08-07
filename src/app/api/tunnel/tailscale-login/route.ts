import { NextResponse } from "next/server";
import { checkStrictDashboardAuth } from "@/lib/routeAuth";
import { sanitizeError } from "@/lib/sanitizeError";
import { generateShortId, loadState } from "@/lib/tunnel/state";
export async function POST(request: Request) {
  try {
    const authResponse = await checkStrictDashboardAuth(request);
    if (authResponse) return authResponse;

    const { startLogin } = await import("@/lib/tunnel/tailscale");
    const state = loadState();
    const shortId = (typeof state?.shortId === "string" && state.shortId) || generateShortId();
    const result = await startLogin(shortId);
    return NextResponse.json(result);
  } catch (error) {
    console.error("Tailscale login error:", error);
    return NextResponse.json({ error: sanitizeError(error) }, { status: 500 });
  }
}
