import { NextResponse } from "next/server";
import {
  DEFAULT_HEADROOM_URL,
  isLoopbackHeadroomUrl,
  resolveHeadroomPort,
} from "@/lib/headroom/detect.ts";
import { restartHeadroomProxy } from "@/lib/headroom/process.ts";
import { getSettings } from "@/lib/localDb";
import { checkDashboardApiAuth } from "@/lib/routeAuth";
import { sanitizeError } from "@/lib/sanitizeError";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function errCode(error: unknown): string | null {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") {
    return error.code;
  }
  return null;
}

export async function POST(request: Request) {
  const denied = await checkDashboardApiAuth(request);
  if (denied) return denied;

  try {
    const settings = await getSettings();
    const url = String(settings.headroomUrl || DEFAULT_HEADROOM_URL);
    if (!isLoopbackHeadroomUrl(url)) {
      return NextResponse.json(
        {
          error: "External Headroom proxies must be started outside Pod",
          code: "EXTERNAL_PROXY",
        },
        { status: 400 },
      );
    }
    const result = await restartHeadroomProxy({
      port: resolveHeadroomPort(url),
      codeAware: settings.headroomCodeAware === true,
      kompress: settings.headroomKompress !== false,
    });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    const code = errCode(error);
    return NextResponse.json(
      { error: sanitizeError(error), code },
      { status: code === "NOT_INSTALLED" ? 400 : 500 },
    );
  }
}
