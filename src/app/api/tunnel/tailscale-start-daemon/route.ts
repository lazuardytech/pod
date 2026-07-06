"use server";

import { NextResponse } from "next/server";
import { checkStrictDashboardAuth } from "@/lib/routeAuth";

import { sanitizeError } from "@/lib/sanitizeError";
export async function POST(request: any) {
  try {
    const authResponse = await checkStrictDashboardAuth(request);
    if (authResponse) return authResponse;

    const { startDaemonWithPassword } = await import("@/lib/tunnel/tailscale");
    await startDaemonWithPassword("");
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Tailscale start daemon error:", error);
    return NextResponse.json({ error: sanitizeError(error) }, { status: 500 });
  }
}
