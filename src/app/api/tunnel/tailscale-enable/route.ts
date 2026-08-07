import { NextResponse } from "next/server";
import { checkStrictDashboardAuth } from "@/lib/routeAuth";
import { sanitizeError } from "@/lib/sanitizeError";
import { enableTailscale } from "@/lib/tunnel/tunnelManager";
export async function POST(request: Request) {
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
