import { NextResponse } from "next/server";
import { disableTailscale } from "@/lib/tunnel/tunnelManager";

import { sanitizeError } from "@/lib/sanitizeError";
export async function POST() {
  try {
    const result = await disableTailscale();
    return NextResponse.json(result);
  } catch (error) {
    console.error("Tailscale disable error:", error);
    return NextResponse.json({ error: sanitizeError(error) }, { status: 500 });
  }
}
