import { asString, proxyTestError } from "@/app/api/_types";
import { NextResponse } from "next/server";
import { testProxyUrl } from "@/lib/network/proxyTest";
import { sanitizeError } from "@/lib/sanitizeError";
import { getProxyPoolById, updateProxyPool } from "@/models";

function buildRelayHeaders(proxyPool: Record<string, unknown>) {
  const headers: Record<string, string> = {
    "x-relay-target": "https://www.google.com",
    "x-relay-path": "/generate_204",
    Accept: "*/*",
    "User-Agent": "pod-relay-healthcheck/1.0",
  };

  if (proxyPool?.relayAuthToken) {
    headers["x-relay-auth"] = asString(proxyPool.relayAuthToken);
  }

  return headers;
}

async function testVercelRelay(proxyPool: Record<string, unknown>, timeoutMs: number = 10000) {
  const controller = new AbortController();
  const startedAt = Date.now();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const { fetch: undiciFetch } = await import("undici");
    const res = await undiciFetch(asString(proxyPool.proxyUrl), {
      method: "GET",
      headers: buildRelayHeaders(proxyPool),
      signal: controller.signal,
    });
    return {
      ok: res.ok,
      status: res.status,
      statusText: res.statusText,
      elapsedMs: Date.now() - startedAt,
    };
  } catch (err) {
    return {
      ok: false,
      status: 500,
      error: (err as Error)?.name === "AbortError" ? "Relay test timed out" : sanitizeError(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

// POST /api/proxy-pools/[id]/test - Test proxy pool entry
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const proxyPool = await getProxyPoolById(id);

    if (!proxyPool) {
      return NextResponse.json({ error: "Proxy pool not found" }, { status: 404 });
    }

    const result =
      proxyPool.type === "vercel"
        ? await testVercelRelay(proxyPool as Record<string, unknown>)
        : await testProxyUrl({ proxyUrl: proxyPool.proxyUrl });
    const now = new Date().toISOString();

    const testResult = result as {
      ok: boolean;
      status?: number;
      statusText?: string;
      error?: string;
      elapsedMs?: number;
    };

    await updateProxyPool(id, {
      testStatus: testResult.ok ? "active" : "error",
      lastTestedAt: now,
      lastError: testResult.ok
        ? null
        : proxyTestError(testResult) || `Proxy test failed with status ${testResult.status}`,
      isActive: testResult.ok,
    });

    return NextResponse.json({
      ok: testResult.ok,
      status: testResult.status,
      statusText: testResult.statusText || null,
      error: testResult.error || null,
      elapsedMs: testResult.elapsedMs || 0,
      testedAt: now,
    });
  } catch (error) {
    console.error("Error testing proxy pool:", error);
    return NextResponse.json({ error: sanitizeError(error) }, { status: 500 });
  }
}
