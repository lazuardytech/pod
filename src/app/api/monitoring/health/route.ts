import { NextResponse } from "next/server";
import { checkMonitoringAuth } from "./_auth";
import { buildHealthPayload } from "./_health";

import { sanitizeError } from "@/lib/sanitizeError";
export const dynamic = "force-dynamic";

// GET /api/monitoring/health — full snapshot
//
// Auth (see _auth.js): API key (Bearer / x-api-key) OR dashboard JWT cookie.
// The cookie path is what allows the in-app /health page to read this endpoint
// without leaking the API key into the browser bundle.
export async function GET(request) {
  const unauthorized = await checkMonitoringAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const payload = await buildHealthPayload();
    return NextResponse.json(payload);
  } catch (err) {
    return NextResponse.json({ error: sanitizeError(err) }, { status: 500 });
  }
}
