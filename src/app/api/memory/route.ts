import { NextResponse } from "next/server";
import { asApiRecord } from "@/app/api/_types";
import { clearMemories, createMemory, listMemories } from "@/lib/memory/store";
import { MemoryType } from "@/lib/memory/types";
import { parseJsonBody } from "@/lib/parseJsonBody";
import { sanitizeError } from "@/lib/sanitizeError";

function parsePositiveInt(value: any, fallback: any) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : fallback;
}

export async function GET(request: any) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parsePositiveInt(searchParams.get("limit"), 50);
    const page = parsePositiveInt(searchParams.get("page"), 1);
    const offsetRaw = searchParams.get("offset");
    const offset =
      typeof offsetRaw === "string" && offsetRaw.trim().length > 0
        ? Math.max(0, Number.parseInt(offsetRaw, 10) || 0)
        : (page - 1) * limit;

    const apiKeyId = searchParams.get("apiKeyId") || undefined;
    const sessionId = searchParams.get("sessionId") || undefined;
    const type = searchParams.get("type") || undefined;
    const query = searchParams.get("q") || undefined;

    const result = await listMemories({ apiKeyId, sessionId, type, query, limit, offset });
    return NextResponse.json({
      data: result.data,
      total: result.total,
      page: Math.floor(offset / limit) + 1,
      limit,
      totalPages: Math.max(1, Math.ceil(result.total / limit)),
      stats: {
        total: result.total,
        byType: result.byType || {},
      },
    });
  } catch (error) {
    return NextResponse.json({ error: sanitizeError(error) }, { status: 500 });
  }
}

export async function POST(request: any) {
  try {
    const [rawBody, _parseErr] = await parseJsonBody(request);
    if (_parseErr) return _parseErr;
    const body = rawBody as Record<string, unknown>;
    const content = typeof body.content === "string" ? body.content.trim() : "";
    const key = typeof body.key === "string" ? body.key.trim() : "";
    const apiKeyId = typeof body.apiKeyId === "string" ? body.apiKeyId.trim() : "";
    const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
    const type = Object.values(MemoryType).includes(
      body.type as (typeof MemoryType)[keyof typeof MemoryType],
    )
      ? (body.type as (typeof MemoryType)[keyof typeof MemoryType])
      : MemoryType.FACTUAL;

    if (!apiKeyId) return NextResponse.json({ error: "apiKeyId is required" }, { status: 400 });
    if (!content) return NextResponse.json({ error: "content is required" }, { status: 400 });
    if (!key) return NextResponse.json({ error: "key is required" }, { status: 400 });

    const memory = await createMemory({
      apiKeyId,
      sessionId,
      type,
      key,
      content,
      metadata: asApiRecord(body.metadata),
      expiresAt: (body.expiresAt as string | Date | null) ?? null,
    });

    return NextResponse.json({ success: true, data: memory });
  } catch (error) {
    return NextResponse.json({ error: sanitizeError(error) }, { status: 400 });
  }
}

export async function DELETE(request: any) {
  try {
    const { searchParams } = new URL(request.url);
    const apiKeyIdRaw = searchParams.get("apiKeyId");
    const apiKeyId = typeof apiKeyIdRaw === "string" ? apiKeyIdRaw.trim() : "";
    const removed = await clearMemories(apiKeyId || null);
    return NextResponse.json({
      success: true,
      removed,
      scope: apiKeyId ? "apiKey" : "all",
      apiKeyId: apiKeyId || null,
    });
  } catch (error) {
    return NextResponse.json({ error: sanitizeError(error) }, { status: 500 });
  }
}
