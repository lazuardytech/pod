import { NextResponse } from "next/server";
import { getSettings, validateApiKey } from "@/lib/localDb";
import { extractApiKey } from "@/sse/services/auth.js";
import { buildHealthPayload } from "./_health.js";

export const dynamic = "force-dynamic";

// GET /api/monitoring/health — full snapshot (auth-protected when requireApiKey=true)
export async function GET(request) {
  try {
    const settings = await getSettings();
    if (settings.requireApiKey) {
      const apiKey = extractApiKey(request);
      if (!apiKey) {
        return NextResponse.json({ error: "API key required" }, { status: 401 });
      }
      const valid = await validateApiKey(apiKey);
      if (!valid) {
        return NextResponse.json({ error: "API key required" }, { status: 401 });
      }
    }

    const payload = await buildHealthPayload();
    return NextResponse.json(payload);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
