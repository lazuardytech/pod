import { NextResponse } from "next/server";
import { probeHeadroom } from "open-sse/rtk/headroom.ts";
import { DEFAULT_HEADROOM_URL, getHeadroomStatus } from "@/lib/headroom/detect.ts";
import { getManagedPid } from "@/lib/headroom/process.ts";
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
    const url = String(settings.headroomUrl || DEFAULT_HEADROOM_URL);
    const status = await getHeadroomStatus(url);
    const probe = await probeHeadroom(url);
    return NextResponse.json({
      ...status,
      url,
      managedPid: getManagedPid(),
      reachable: probe.ok,
      reason: probe.reason ?? null,
    });
  } catch (error) {
    return NextResponse.json({ error: sanitizeError(error) }, { status: 500 });
  }
}
