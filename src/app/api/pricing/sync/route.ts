import { NextResponse } from "next/server";
import { asString } from "@/app/api/_types";
import {
  getSyncStatus,
  startPeriodicSync,
  stopPeriodicSync,
  syncModelsDev,
} from "@/lib/modelsDevSync";
import { sanitizeError } from "@/lib/sanitizeError";
// GET — return current sync status
export async function GET() {
  try {
    const status = getSyncStatus();
    return NextResponse.json({ success: true, ...status });
  } catch (err) {
    return NextResponse.json({ success: false, error: sanitizeError(err) }, { status: 500 });
  }
}

// POST — trigger immediate sync or control periodic sync
// Body (optional): { action: "start" | "stop" | "sync", intervalMs?: number }
export async function POST(request: any) {
  try {
    let body: Record<string, unknown> = {};
    try {
      const text = await request.text();
      if (text) {
        const parsed = JSON.parse(text);
        body = parsed as Record<string, unknown>;
      }
    } catch {
      // no body or invalid JSON is fine
    }

    const action = asString(body.action) || "sync";

    if (action === "start") {
      // ponytail: guard at trust boundary — reject interval < 60s (CodeQL)
      const raw = Number(body.intervalMs) || 3600000;
      const intervalMs = typeof raw === "number" && Number.isFinite(raw) && raw >= 60_000 ? raw : 3_600_000;
      startPeriodicSync(intervalMs);
      return NextResponse.json({ success: true, action: "start", ...getSyncStatus() });
    }

    if (action === "stop") {
      stopPeriodicSync();
      return NextResponse.json({ success: true, action: "stop", ...getSyncStatus() });
    }

    // Default: trigger immediate sync
    const result = await syncModelsDev();
    return NextResponse.json({ action: "sync", ...result, ...getSyncStatus() });
  } catch (err) {
    return NextResponse.json({ success: false, error: sanitizeError(err) }, { status: 500 });
  }
}
