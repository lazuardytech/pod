import { NextResponse } from "next/server";
import { enableTunnel } from "@/lib/tunnel/tunnelManager";
import { checkStrictDashboardAuth } from "@/lib/routeAuth";

import { sanitizeError } from "@/lib/sanitizeError";
export async function POST(request: any) {
  try {
    const authResponse = await checkStrictDashboardAuth(request);
    if (authResponse) return authResponse;

    const result = await enableTunnel();
    return NextResponse.json(result);
  } catch (error) {
    console.error("Tunnel enable error:", error);
    return NextResponse.json({ error: sanitizeError(error) }, { status: 500 });
  }
}
