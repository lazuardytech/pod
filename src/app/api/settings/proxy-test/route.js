import { NextResponse } from "next/server";
import { testProxyUrl } from "@/lib/network/proxyTest";
import { sanitizeError } from "@/lib/sanitizeError.js";
import { parseJsonBody } from "@/lib/parseJsonBody.js";

export async function POST(request) {
  try {
    const [body, _parseErr] = await parseJsonBody(request);
    if (_parseErr) return _parseErr;
    const result = await testProxyUrl({
      proxyUrl: body?.proxyUrl,
      testUrl: body?.testUrl,
      timeoutMs: body?.timeoutMs,
    });

    if (result?.ok) {
      return NextResponse.json(result);
    }

    const status = typeof result?.status === "number" ? result.status : 500;
    return NextResponse.json({ ok: false, error: result?.error || "Proxy test failed" }, { status });
  } catch (err) {
    const message = err?.name === "AbortError" ? "Proxy test timed out" : sanitizeError(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
