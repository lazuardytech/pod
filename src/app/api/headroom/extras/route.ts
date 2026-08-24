import { NextResponse } from "next/server";
import {
  findPython310,
  getInstalledHeadroomExtras,
  HEADROOM_COMPRESSION_EXTRAS,
} from "@/lib/headroom/detect.ts";
import {
  getInstallLogTail,
  installHeadroomExtras,
  uninstallHeadroomExtras,
} from "@/lib/headroom/process.ts";
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

async function readExtrasBody(request: Request): Promise<unknown[]> {
  const raw = await request.text();
  if (!raw.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const err = new Error("Invalid JSON body") as Error & { code: string };
    err.code = "INVALID_JSON";
    throw err;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
  const extras = (parsed as { extras?: unknown }).extras;
  return Array.isArray(extras) ? extras : [];
}

export async function GET(request: Request) {
  const denied = await checkDashboardApiAuth(request);
  if (denied) return denied;

  try {
    if (new URL(request.url).searchParams.get("log") === "1") {
      return NextResponse.json({ log: getInstallLogTail() });
    }
    const python = findPython310();
    return NextResponse.json({
      available: HEADROOM_COMPRESSION_EXTRAS,
      ...getInstalledHeadroomExtras(python),
    });
  } catch (error) {
    return NextResponse.json({ error: sanitizeError(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const denied = await checkDashboardApiAuth(request);
  if (denied) return denied;

  try {
    const extras = await readExtrasBody(request);
    const result = await installHeadroomExtras(extras);
    return NextResponse.json(result);
  } catch (error) {
    const code = errCode(error);
    const status =
      code === "NOT_INSTALLED" || code === "NO_PYTHON" || code === "INVALID_JSON" ? 400 : 500;
    return NextResponse.json({ error: sanitizeError(error), code }, { status });
  }
}

export async function DELETE(request: Request) {
  const denied = await checkDashboardApiAuth(request);
  if (denied) return denied;

  try {
    const extras = await readExtrasBody(request);
    const result = await uninstallHeadroomExtras(extras);
    return NextResponse.json(result);
  } catch (error) {
    const code = errCode(error);
    const status =
      code === "NO_PYTHON" || code === "INVALID_EXTRAS" || code === "INVALID_JSON" ? 400 : 500;
    return NextResponse.json({ error: sanitizeError(error), code }, { status });
  }
}
