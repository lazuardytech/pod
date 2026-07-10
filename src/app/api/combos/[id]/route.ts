import { NextResponse } from "next/server";
import { resetComboRotation } from "open-sse/services/combo.js";
import { asString } from "@/app/api/_types";
import { deleteCombo, getComboById, getComboByName, updateCombo } from "@/lib/localDb";
import { parseJsonBody } from "@/lib/parseJsonBody";

// Validate combo name: only a-z, A-Z, 0-9, -, _
const VALID_NAME_REGEX = /^[a-zA-Z0-9_.-]+$/;

// GET /api/combos/[id] - Get combo by ID
export async function GET(request: any, { params }: { params: any }) {
  try {
    const { id } = await params;
    const combo = await getComboById(id);

    if (!combo) {
      return NextResponse.json({ error: "Combo not found" }, { status: 404 });
    }

    return NextResponse.json(combo);
  } catch (error) {
    console.log("Error fetching combo:", error);
    return NextResponse.json({ error: "Failed to fetch combo" }, { status: 500 });
  }
}

// PUT /api/combos/[id] - Update combo
export async function PUT(request: any, { params }: { params: any }) {
  try {
    const { id } = await params;
    const [rawBody, _parseErr] = await parseJsonBody(request);
    if (_parseErr) return _parseErr;
    const body = rawBody as Record<string, unknown>;

    // Validate name format if provided
    if (body.name) {
      const name = asString(body.name);
      if (!VALID_NAME_REGEX.test(name)) {
        return NextResponse.json(
          { error: "Name can only contain letters, numbers, -, _ and ." },
          { status: 400 },
        );
      }

      // Check if name already exists (exclude current combo)
      const existing = await getComboByName(name);
      if (existing && existing.id !== id) {
        return NextResponse.json({ error: "Combo name already exists" }, { status: 400 });
      }
    }

    if ("systemPrompt" in body) {
      if (
        body.systemPrompt !== null &&
        body.systemPrompt !== undefined &&
        typeof body.systemPrompt !== "string"
      ) {
        return NextResponse.json({ error: "systemPrompt must be a string" }, { status: 400 });
      }
      if (typeof body.systemPrompt === "string" && body.systemPrompt.length > 50000) {
        return NextResponse.json(
          { error: "systemPrompt exceeds 50000 characters" },
          { status: 400 },
        );
      }
      body.systemPrompt =
        typeof body.systemPrompt === "string" && body.systemPrompt.trim()
          ? body.systemPrompt
          : null;
    }

    if ("modelId" in body) {
      if (body.modelId !== null && body.modelId !== undefined && typeof body.modelId !== "string") {
        return NextResponse.json({ error: "modelId must be a string" }, { status: 400 });
      }
      body.modelId =
        typeof body.modelId === "string" && body.modelId.trim() ? body.modelId.trim() : null;
    }

    if ("contentFilterMessage" in body) {
      if (
        body.contentFilterMessage !== null &&
        body.contentFilterMessage !== undefined &&
        typeof body.contentFilterMessage !== "string"
      ) {
        return NextResponse.json(
          { error: "contentFilterMessage must be a string" },
          { status: 400 },
        );
      }
      if (
        typeof body.contentFilterMessage === "string" &&
        body.contentFilterMessage.length > 2000
      ) {
        return NextResponse.json(
          { error: "contentFilterMessage exceeds 2000 characters" },
          { status: 400 },
        );
      }
      body.contentFilterMessage =
        typeof body.contentFilterMessage === "string" && body.contentFilterMessage.trim()
          ? body.contentFilterMessage.trim()
          : null;
    }

    // Capture previous name to invalidate rotation state on rename
    const prev = await getComboById(id);
    const combo = await updateCombo(id, body);

    if (!combo) {
      return NextResponse.json({ error: "Combo not found" }, { status: 404 });
    }

    // Invalidate rotation state (models/strategy/name may have changed)
    if (prev?.name) resetComboRotation(prev.name);
    if (combo.name && combo.name !== prev?.name) resetComboRotation(combo.name);

    return NextResponse.json(combo);
  } catch (error) {
    console.log("Error updating combo:", error);
    return NextResponse.json({ error: "Failed to update combo" }, { status: 500 });
  }
}

// DELETE /api/combos/[id] - Delete combo
export async function DELETE(request: any, { params }: { params: any }) {
  try {
    const { id } = await params;
    const prev = await getComboById(id);
    const success = await deleteCombo(id);

    if (!success) {
      return NextResponse.json({ error: "Combo not found" }, { status: 404 });
    }

    if (prev?.name) resetComboRotation(prev.name);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.log("Error deleting combo:", error);
    return NextResponse.json({ error: "Failed to delete combo" }, { status: 500 });
  }
}
