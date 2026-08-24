import { NextResponse } from "next/server";
import { sanitizeError } from "@/lib/sanitizeError";
import { buildHealthPayload } from "./_health";
export const dynamic = "force-dynamic";

// GET /api/monitoring/health — full snapshot (public read).
// Same allowlist as /api/health: no dashboard session required.
export async function GET(_request: Request) {
  try {
    const payload = await buildHealthPayload();
    return NextResponse.json(payload);
  } catch (err) {
    return NextResponse.json({ error: sanitizeError(err) }, { status: 500 });
  }
}
