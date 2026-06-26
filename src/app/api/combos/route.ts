import { asString } from "@/app/api/_types";
import { NextResponse } from "next/server";
import { createCombo, getComboByName, getCombos, reorderCombos } from "@/lib/localDb";
import { parseJsonBody } from "@/lib/parseJsonBody";

export const dynamic = "force-dynamic";

// Validate combo name: only a-z, A-Z, 0-9, -, _
const VALID_NAME_REGEX = /^[a-zA-Z0-9_.-]+$/;

// GET /api/combos - Get all combos
export async function GET() {
  try {
    const combos = await getCombos();
    return NextResponse.json({ combos });
  } catch (error) {
    console.log("Error fetching combos:", error);
    return NextResponse.json({ error: "Failed to fetch combos" }, { status: 500 });
  }
}

// PATCH /api/combos - Reorder combos
export async function PATCH(request) {
  try {
    const [rawBody, _parseErr] = await parseJsonBody(request);
    if (_parseErr) return _parseErr;
    const body = rawBody as Record<string, unknown>;
    const { order } = body;

    if (!Array.isArray(order) || order.some((id) => typeof id !== "string")) {
      return NextResponse.json({ error: "order must be an array of string IDs" }, { status: 400 });
    }

    await reorderCombos(order);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.log("Error reordering combos:", error);
    return NextResponse.json({ error: "Failed to reorder combos" }, { status: 500 });
  }
}

// POST /api/combos - Create new combo
export async function POST(request) {
  try {
    const [rawBody, _parseErr] = await parseJsonBody(request);
    if (_parseErr) return _parseErr;
    const body = rawBody as Record<string, unknown>;
    const { name, models, kind, systemPrompt, modelId, contentFilterMessage } = body;

    if (!name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    // Validate name format
    if (!VALID_NAME_REGEX.test(asString(name))) {
      return NextResponse.json({ error: "Name can only contain letters, numbers, -, _ and ." }, { status: 400 });
    }

    if (systemPrompt != null && typeof systemPrompt !== "string") {
      return NextResponse.json({ error: "systemPrompt must be a string" }, { status: 400 });
    }
    if (typeof systemPrompt === "string" && systemPrompt.length > 50000) {
      return NextResponse.json({ error: "systemPrompt exceeds 50000 characters" }, { status: 400 });
    }

    if (modelId != null && typeof modelId !== "string") {
      return NextResponse.json({ error: "modelId must be a string" }, { status: 400 });
    }

    if (contentFilterMessage != null && typeof contentFilterMessage !== "string") {
      return NextResponse.json({ error: "contentFilterMessage must be a string" }, { status: 400 });
    }
    if (typeof contentFilterMessage === "string" && contentFilterMessage.length > 2000) {
      return NextResponse.json({ error: "contentFilterMessage exceeds 2000 characters" }, { status: 400 });
    }

    // Check if name already exists
    const existing = await getComboByName(asString(name));
    if (existing) {
      return NextResponse.json({ error: "Combo name already exists" }, { status: 400 });
    }

    const combo = await createCombo({
      name,
      models: models || [],
      kind: kind || null,
      systemPrompt: typeof systemPrompt === "string" && systemPrompt.trim() ? systemPrompt : null,
      modelId: typeof modelId === "string" && modelId.trim() ? modelId.trim() : null,
      contentFilterMessage:
        typeof contentFilterMessage === "string" && contentFilterMessage.trim() ? contentFilterMessage.trim() : null,
    });

    return NextResponse.json(combo, { status: 201 });
  } catch (error) {
    console.log("Error creating combo:", error);
    return NextResponse.json({ error: "Failed to create combo" }, { status: 500 });
  }
}
