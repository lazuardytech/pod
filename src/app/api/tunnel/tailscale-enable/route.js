import { NextResponse } from "next/server";
import { enableTailscale } from "@/lib/tunnel/tunnelManager";

import { sanitizeError } from "@/lib/sanitizeError.js";
export async function POST() {
  try {
    const result = await enableTailscale();
    return NextResponse.json(result);
  } catch (error) {
    console.error("Tailscale enable error:", error);
    return NextResponse.json({ error: sanitizeError(error) }, { status: 500 });
  }
}
