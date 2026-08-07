import { NextResponse } from "next/server";
import { asString } from "@/app/api/_types";
import { getSettings, updateSettings } from "@/lib/localDb";
import { normalizeMemorySettings, toMemorySettingsUpdates } from "@/lib/memory/settings";
import { parseJsonBody } from "@/lib/parseJsonBody";
import { sanitizeError } from "@/lib/sanitizeError";

function toBooleanOrNull(value: unknown) {
  if (typeof value === "boolean") return value;
  return null;
}

function toBoundedIntOrNull(value: unknown, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const rounded = Math.round(parsed);
  if (rounded < min || rounded > max) return null;
  return rounded;
}

export async function GET() {
  try {
    const settings = await getSettings();
    return NextResponse.json(normalizeMemorySettings(settings));
  } catch (error) {
    return NextResponse.json({ error: sanitizeError(error) }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const [rawBody, _parseErr] = await parseJsonBody(request);
    if (_parseErr) return _parseErr;
    const body = rawBody as Record<string, unknown>;
    const patch: Record<string, unknown> = {};

    if (body.enabled !== undefined) {
      const value = toBooleanOrNull(body.enabled);
      if (value === null)
        return NextResponse.json({ error: "enabled must be boolean" }, { status: 400 });
      patch.enabled = value;
    }
    if (body.maxTokens !== undefined) {
      const value = toBoundedIntOrNull(body.maxTokens, 0, 16000);
      if (value === null)
        return NextResponse.json({ error: "maxTokens must be integer 0..16000" }, { status: 400 });
      patch.maxTokens = value;
    }
    if (body.retentionDays !== undefined) {
      const value = toBoundedIntOrNull(body.retentionDays, 1, 365);
      if (value === null) {
        return NextResponse.json(
          { error: "retentionDays must be integer 1..365" },
          { status: 400 },
        );
      }
      patch.retentionDays = value;
    }
    if (body.strategy !== undefined) {
      if (!["recent", "semantic", "hybrid"].includes(asString(body.strategy))) {
        return NextResponse.json(
          { error: "strategy must be one of: recent, semantic, hybrid" },
          { status: 400 },
        );
      }
      patch.strategy = body.strategy;
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "No valid fields to update." }, { status: 400 });
    }

    const updates = toMemorySettingsUpdates(patch);
    const settings = await updateSettings(updates);
    return NextResponse.json(normalizeMemorySettings(settings));
  } catch (error) {
    return NextResponse.json({ error: sanitizeError(error) }, { status: 500 });
  }
}
