"use server";

import { NextResponse } from "next/server";
import { startDaemonWithPassword } from "@/lib/tunnel/tailscale";

import { sanitizeError } from "@/lib/sanitizeError.js";
export async function POST() {
  try {
    await startDaemonWithPassword("");
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Tailscale start daemon error:", error);
    return NextResponse.json({ error: sanitizeError(error) }, { status: 500 });
  }
}
