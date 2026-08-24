import { NextResponse } from "next/server";
import { sanitizeError } from "@/lib/sanitizeError";
import { disableTailscale } from "@/lib/tunnel/tunnelManager";
import { checkStrictDashboardAuth } from "@/lib/routeAuth";
export async function POST(request: Request) {
  const denied = await checkStrictDashboardAuth(request);
  if (denied) return denied;

  try {
    const result = await disableTailscale();
    return NextResponse.json(result);
  } catch (error) {
    console.error("Tailscale disable error:", error);
    return NextResponse.json({ error: sanitizeError(error) }, { status: 500 });
  }
}
