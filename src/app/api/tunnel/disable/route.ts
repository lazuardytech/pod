import { NextResponse } from "next/server";
import { checkStrictDashboardAuth } from "@/lib/routeAuth";
import { sanitizeError } from "@/lib/sanitizeError";
import { disableTunnel } from "@/lib/tunnel/tunnelManager";
export async function POST(request: any) {
  try {
    const authResponse = await checkStrictDashboardAuth(request);
    if (authResponse) return authResponse;

    const result = await disableTunnel();
    return NextResponse.json(result);
  } catch (error) {
    console.error("Tunnel disable error:", error);
    return NextResponse.json({ error: sanitizeError(error) }, { status: 500 });
  }
}
