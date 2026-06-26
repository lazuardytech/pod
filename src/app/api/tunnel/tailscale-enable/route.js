import { NextResponse } from "next/server";
import { enableTailscale } from "@/lib/tunnel/tunnelManager";
import { checkStrictDashboardAuth } from "@/lib/routeAuth.js";

import { sanitizeError } from "@/lib/sanitizeError";
export async function POST(request) {
  try {
    const authResponse = await checkStrictDashboardAuth(request);
    if (authResponse) return authResponse;

    const result = await enableTailscale();
    return NextResponse.json(result);
  } catch (error) {
    console.error("Tailscale enable error:", error);
    return NextResponse.json({ error: sanitizeError(error) }, { status: 500 });
  }
}
