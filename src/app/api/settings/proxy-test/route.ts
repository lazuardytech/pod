import { NextResponse } from "next/server";
import { proxyTestError } from "@/app/api/_types";
import { testProxyUrl } from "@/lib/network/proxyTest";
import { parseJsonBody } from "@/lib/parseJsonBody";
import { sanitizeError } from "@/lib/sanitizeError";

export async function POST(request: any) {
  try {
    const [rawBody, _parseErr] = await parseJsonBody(request);
    if (_parseErr) return _parseErr;
    const body = rawBody as Record<string, unknown>;
    const result = await testProxyUrl({
      proxyUrl: body?.proxyUrl,
      testUrl: body?.testUrl,
      timeoutMs: body?.timeoutMs,
    });

    if (result?.ok) {
      return NextResponse.json(result);
    }

    const status = typeof result?.status === "number" ? result.status : 500;
    return NextResponse.json(
      { ok: false, error: proxyTestError(result) || "Proxy test failed" },
      { status },
    );
  } catch (err) {
    const message =
      (err as any)?.name === "AbortError" ? "Proxy test timed out" : sanitizeError(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
