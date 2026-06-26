import { NextResponse } from "next/server";
import { deleteMemory, getMemory, updateMemory } from "@/lib/memory/store";
import { parseJsonBody } from "@/lib/parseJsonBody";
import { sanitizeError } from "@/lib/sanitizeError";
export async function GET(_request: any, { params }: { params: any }) {
  try {
    const { id } = await params;
    const memory = await getMemory(id);
    if (!memory) return NextResponse.json({ error: "Memory not found" }, { status: 404 });
    return NextResponse.json(memory);
  } catch (error) {
    return NextResponse.json({ error: sanitizeError(error) }, { status: 500 });
  }
}

export async function PATCH(request: any, { params }: { params: any }) {
  try {
    const { id } = await params;
    const [rawBody, _parseErr] = await parseJsonBody(request);
    if (_parseErr) return _parseErr;
    const body = rawBody as Record<string, unknown>;
    const updates: Record<string, unknown> = {};

    if (body.type !== undefined) updates.type = body.type;
    if (body.key !== undefined) updates.key = body.key;
    if (body.content !== undefined) updates.content = body.content;
    if (body.metadata !== undefined) updates.metadata = body.metadata;
    if (body.expiresAt !== undefined) updates.expiresAt = body.expiresAt;
    if (body.sessionId !== undefined) updates.sessionId = body.sessionId;

    const updated = await updateMemory(id, updates);
    if (!updated) return NextResponse.json({ error: "Memory not found or no changes applied" }, { status: 404 });

    const memory = await getMemory(id);
    return NextResponse.json({ success: true, data: memory });
  } catch (error) {
    return NextResponse.json({ error: sanitizeError(error) }, { status: 400 });
  }
}

export async function DELETE(_request: any, { params }: { params: any }) {
  try {
    const { id } = await params;
    const deleted = await deleteMemory(id);
    if (!deleted) return NextResponse.json({ error: "Memory not found" }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: sanitizeError(error) }, { status: 500 });
  }
}
