import { NextResponse } from "next/server";
import { enableTunnel } from "@/lib/tunnel/tunnelManager";

import { sanitizeError } from "@/lib/sanitizeError.js";
export async function POST() {
  try {
    const result = await enableTunnel();
    return NextResponse.json(result);
  } catch (error) {
    console.error("Tunnel enable error:", error);
    return NextResponse.json({ error: sanitizeError(error) }, { status: 500 });
  }
}
