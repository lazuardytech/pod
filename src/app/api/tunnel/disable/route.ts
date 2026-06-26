import { NextResponse } from "next/server";
import { disableTunnel } from "@/lib/tunnel/tunnelManager";
import { checkStrictDashboardAuth } from "@/lib/routeAuth";

import { sanitizeError } from "@/lib/sanitizeError";
export async function POST(request) {
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
