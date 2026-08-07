import { NextResponse } from "next/server";
import { sanitizeError } from "@/lib/sanitizeError";
import { buildHealthPayload } from "./_health";
export const dynamic = "force-dynamic";

// GET /api/monitoring/health — full snapshot (public read).
//
// This is an unguarded dashboard read, consistent with /api/providers,
// /api/usage/stats, and /api/settings. No auth header is required, so the
// in-app /health page can read it without leaking the API key into the
// browser bundle.
export async function GET(_request: Request) {
  try {
    const payload = await buildHealthPayload();
    return NextResponse.json(payload);
  } catch (err) {
    return NextResponse.json({ error: sanitizeError(err) }, { status: 500 });
  }
}
