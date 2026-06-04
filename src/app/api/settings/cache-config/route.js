import { NextResponse } from "next/server";
import { getSettings, updateSettings } from "@/lib/localDb";

import { sanitizeError } from "@/lib/sanitizeError.js";
import { parseJsonBody } from "@/lib/parseJsonBody.js";
const DEFAULTS = {
  semanticCacheEnabled: true,
  semanticCacheMaxSize: 100,
  semanticCacheTTL: 1800000,
};

const ALLOWED_KEYS = new Set(Object.keys(DEFAULTS));

function toPositiveInt(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : null;
}

export async function GET() {
  try {
    const settings = await getSettings();
    const config = {};
    for (const key of ALLOWED_KEYS) config[key] = settings[key] ?? DEFAULTS[key];
    return NextResponse.json(config);
  } catch (error) {
    return NextResponse.json({ error: sanitizeError(error) || String(error) }, { status: 500 });
  }
}

export async function PUT(request) {
  try {
    const [body, _parseErr] = await parseJsonBody(request);
    if (_parseErr) return _parseErr;
    const updates = {};

    if (body.semanticCacheEnabled !== undefined) {
      if (typeof body.semanticCacheEnabled !== "boolean") {
        return NextResponse.json({ error: "semanticCacheEnabled must be boolean" }, { status: 400 });
      }
      updates.semanticCacheEnabled = body.semanticCacheEnabled;
    }

    if (body.semanticCacheMaxSize !== undefined) {
      const value = toPositiveInt(body.semanticCacheMaxSize);
      if (value === null) {
        return NextResponse.json({ error: "semanticCacheMaxSize must be a positive integer" }, { status: 400 });
      }
      updates.semanticCacheMaxSize = value;
    }

    if (body.semanticCacheTTL !== undefined) {
      const value = toPositiveInt(body.semanticCacheTTL);
      if (value === null) {
        return NextResponse.json({ error: "semanticCacheTTL must be a positive integer (ms)" }, { status: 400 });
      }
      updates.semanticCacheTTL = value;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No valid fields to update." }, { status: 400 });
    }

    await updateSettings(updates);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: sanitizeError(error) || String(error) }, { status: 500 });
  }
}
