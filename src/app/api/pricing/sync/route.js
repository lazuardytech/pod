import { NextResponse } from "next/server";
import { getSyncStatus, syncModelsDev, startPeriodicSync, stopPeriodicSync } from "@/lib/modelsDevSync.js";

import { sanitizeError } from "@/lib/sanitizeError.js";
import { parseJsonBody } from "@/lib/parseJsonBody.js";
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
export async function POST(request) {
  try {
    let body = {};
    try {
      const [parsed, _parseErr] = await parseJsonBody(request);
      if (_parseErr) return _parseErr;
      body = parsed;
    } catch {
      // no body is fine
    }

    const action = body.action ?? "sync";

    if (action === "start") {
      const intervalMs = body.intervalMs ?? 3600000;
      startPeriodicSync(intervalMs);
      return NextResponse.json({ success: true, action: "start", ...getSyncStatus() });
    }

    if (action === "stop") {
      stopPeriodicSync();
      return NextResponse.json({ success: true, action: "stop", ...getSyncStatus() });
    }

    // Default: trigger immediate sync
    const result = await syncModelsDev();
    return NextResponse.json({ success: result.success, action: "sync", ...result, ...getSyncStatus() });
  } catch (err) {
    return NextResponse.json({ success: false, error: sanitizeError(err) }, { status: 500 });
  }
}
