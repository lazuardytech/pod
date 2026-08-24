import { NextResponse } from "next/server";
import { probeHeadroom } from "open-sse/rtk/headroom.ts";
import { getSettings } from "@/lib/localDb";
import { checkDashboardApiAuth } from "@/lib/routeAuth";
import { sanitizeError } from "@/lib/sanitizeError";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  const denied = await checkDashboardApiAuth(request);
  if (denied) return denied;

  try {
    const settings = await getSettings();
    const url = String(settings.headroomUrl || process.env.HEADROOM_URL || "http://localhost:8787");
    const result = await probeHeadroom(url);
    return NextResponse.json({
      ok: result.ok,
      url,
      reason: result.reason ?? null,
    });
  } catch (error) {
    return NextResponse.json({ error: sanitizeError(error) }, { status: 500 });
  }
}
