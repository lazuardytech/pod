import { NextResponse } from "next/server";
import { stopHeadroomProxy } from "@/lib/headroom/process.ts";
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
    const result = stopHeadroomProxy();
    return NextResponse.json({ ...result }, { status: result.stopped ? 200 : 409 });
  } catch (error) {
    return NextResponse.json(
      { error: sanitizeError(error), code: errCode(error) },
      { status: 500 },
    );
  }
}
