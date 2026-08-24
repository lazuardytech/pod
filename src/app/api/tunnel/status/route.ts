import { NextResponse } from "next/server";
import { sanitizeError } from "@/lib/sanitizeError";
import { getDownloadStatus } from "@/lib/tunnel/downloadState";
import { getTailscaleStatus, getTunnelStatus } from "@/lib/tunnel/tunnelManager";
import { checkDashboardApiAuth } from "@/lib/routeAuth";
export async function GET(request: Request) {
  const denied = await checkDashboardApiAuth(request);
  if (denied) return denied;

  try {
    const [tunnel, tailscale] = await Promise.all([getTunnelStatus(), getTailscaleStatus()]);
    const download = getDownloadStatus();
    return NextResponse.json({ tunnel, tailscale, download });
  } catch (error) {
    console.error("Tunnel status error:", error);
    return NextResponse.json({ error: sanitizeError(error) }, { status: 500 });
  }
}
