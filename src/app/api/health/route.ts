import { NextResponse } from "next/server";

// Public liveness probe — always returns { ok: true } without auth.
// Used by Docker HEALTHCHECK, Kubernetes liveness probes, etc.
// For the full snapshot (also public), see /api/monitoring/health.
export async function GET() {
  return NextResponse.json({ ok: true });
}
