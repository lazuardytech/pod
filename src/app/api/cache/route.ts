import { NextResponse } from "next/server";
import { getSettings } from "@/lib/localDb";
import { sanitizeError } from "@/lib/sanitizeError";
import {
  clearCache,
  getCacheStats,
  invalidateByModel,
  invalidateBySignature,
  invalidateStale,
} from "@/lib/semanticCache";

export async function GET(request: any) {
  try {
    const settings = await getSettings();
    return NextResponse.json({
      semanticCache: getCacheStats(),
      config: {
        semanticCacheEnabled: settings.semanticCacheEnabled ?? false,
        semanticCacheMaxSize: settings.semanticCacheMaxSize ?? 100,
        semanticCacheTTL: settings.semanticCacheTTL ?? 1800000,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: sanitizeError(error) }, { status: 500 });
  }
}

export async function DELETE(request: any) {
  try {
    const { searchParams } = new URL(request.url);
    const model = searchParams.get("model");
    const signature = searchParams.get("signature");
    const staleMsParam = searchParams.get("staleMs");
    const modeCount = [model, signature, staleMsParam].filter(Boolean).length;

    if (modeCount > 1) {
      return NextResponse.json(
        { error: "Only one invalidation parameter (model, signature, staleMs) is allowed." },
        { status: 400 },
      );
    }

    if (model) {
      const invalidated = invalidateByModel(model);
      return NextResponse.json({ ok: true, scope: "model", model, invalidated });
    }
    if (signature) {
      const invalidated = invalidateBySignature(signature) ? 1 : 0;
      return NextResponse.json({ ok: true, scope: "signature", signature, invalidated });
    }
    if (staleMsParam) {
      const maxAgeMs = parseInt(staleMsParam, 10);
      if (Number.isNaN(maxAgeMs) || maxAgeMs <= 0) {
        return NextResponse.json({ error: "staleMs must be a positive integer." }, { status: 400 });
      }
      const invalidated = invalidateStale(maxAgeMs);
      return NextResponse.json({ ok: true, scope: "stale", maxAgeMs, invalidated });
    }

    const cleared = clearCache();
    return NextResponse.json({ ok: true, scope: "all", cleared });
  } catch (error) {
    return NextResponse.json({ error: sanitizeError(error) }, { status: 500 });
  }
}
