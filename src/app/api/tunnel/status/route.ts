import { NextResponse } from "next/server";
import { getDownloadStatus } from "@/lib/tunnel/downloadState";
import { getTailscaleStatus, getTunnelStatus } from "@/lib/tunnel/tunnelManager";

import { sanitizeError } from "@/lib/sanitizeError";
export async function GET() {
  try {
    const [tunnel, tailscale] = await Promise.all([getTunnelStatus(), getTailscaleStatus()]);
    const download = getDownloadStatus();
    return NextResponse.json({ tunnel, tailscale, download });
  } catch (error) {
    console.error("Tunnel status error:", error);
    return NextResponse.json({ error: sanitizeError(error) }, { status: 500 });
  }
}
