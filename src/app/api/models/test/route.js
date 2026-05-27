import { NextResponse } from "next/server";
import { getApiKeys } from "@/lib/localDb";
import { validateFetchUrl } from "@/lib/validateUrl";

// POST /api/models/test - Ping a single model via internal completions or embeddings
export async function POST(request) {
  try {
    const { model, kind } = await request.json();
    if (!model) return NextResponse.json({ error: "Model required" }, { status: 400 });

    const envBase = process.env.BASE_URL;
    // Validate BASE_URL env var if set; fall back to localhost with port from request
    // Using localhost avoids Host-header SSRF (the request hostname is not trusted for fetch).
    const baseUrl = (() => {
      if (envBase) {
        const check = validateFetchUrl(envBase, { allowPrivate: true });
        if (check.ok) return envBase.replace(/\/$/, "");
      }
      // Derive port from request URL but use localhost to avoid Host header SSRF
      const u = new URL(request.url);
      const port = u.port || (u.protocol === "https:" ? "443" : "80");
      return `http://localhost:${port}`;
    })();

    // Get an active internal API key for auth (if requireApiKey is enabled)
    let apiKey = null;
    try {
      const keys = await getApiKeys();
      apiKey = keys.find((k) => k.isActive !== false)?.key || null;
    } catch {}

    const headers = { "Content-Type": "application/json", "x-pod-no-cache": "true" };
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

    const start = Date.now();

    // Route to appropriate endpoint based on kind
    // baseUrl is derived from request host (internal loopback) or BASE_URL env var,
    // validated above with allowPrivate:true — not a user-supplied value. lgtm[js/request-forgery]
    if (kind === "embedding") {
      const res = await fetch(`${baseUrl}/api/v1/embeddings`, {
        // lgtm[js/request-forgery]
        method: "POST",
        headers,
        body: JSON.stringify({ model, input: "test" }),
        signal: AbortSignal.timeout(15000),
      });
      const latencyMs = Date.now() - start;
      const rawText = await res.text().catch(() => "");
      let parsed = null;
      try {
        parsed = rawText ? JSON.parse(rawText) : null;
      } catch {}

      if (!res.ok) {
        const detail = parsed?.error?.message || parsed?.error || rawText;
        return NextResponse.json({
          ok: false,
          latencyMs,
          error: `HTTP ${res.status}${detail ? `: ${String(detail).slice(0, 240)}` : ""}`,
          status: res.status,
        });
      }
      const hasEmbedding =
        Array.isArray(parsed?.data) && parsed.data.length > 0 && Array.isArray(parsed.data[0]?.embedding);
      if (!hasEmbedding) {
        return NextResponse.json({
          ok: false,
          latencyMs,
          status: res.status,
          error: "Provider returned no embedding data",
        });
      }
      return NextResponse.json({ ok: true, latencyMs, error: null, status: res.status });
    }

    // Default: chat completions
    // baseUrl is internal loopback — not user-supplied. lgtm[js/request-forgery]
    const res = await fetch(`${baseUrl}/api/v1/chat/completions`, {
      // lgtm[js/request-forgery]
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        max_tokens: 1,
        stream: false,
        messages: [{ role: "user", content: "hi" }],
      }),
      signal: AbortSignal.timeout(15000),
    });
    const latencyMs = Date.now() - start;

    const rawText = await res.text().catch(() => "");
    let parsed = null;
    try {
      parsed = rawText ? JSON.parse(rawText) : null;
    } catch {}

    if (!res.ok) {
      const detail = parsed?.error?.message || parsed?.msg || parsed?.message || parsed?.error || rawText;
      const error = `HTTP ${res.status}${detail ? `: ${String(detail).slice(0, 240)}` : ""}`;
      return NextResponse.json({ ok: false, latencyMs, error, status: res.status });
    }

    // Some providers may return HTTP 200 but not a real completion for invalid models.
    const providerStatus = parsed?.status;
    const providerMsg = parsed?.msg || parsed?.message;
    const hasProviderErrorStatus =
      providerStatus !== undefined &&
      providerStatus !== null &&
      String(providerStatus) !== "200" &&
      String(providerStatus) !== "0";
    if (hasProviderErrorStatus && providerMsg) {
      return NextResponse.json({
        ok: false,
        latencyMs,
        status: res.status,
        error: `Provider status ${providerStatus}: ${String(providerMsg).slice(0, 240)}`,
      });
    }

    if (parsed?.error) {
      const providerError = parsed?.error?.message || parsed?.error || "Provider returned an error";
      return NextResponse.json({
        ok: false,
        latencyMs,
        status: res.status,
        error: String(providerError).slice(0, 240),
      });
    }

    const hasChoices = Array.isArray(parsed?.choices) && parsed.choices.length > 0;
    if (!hasChoices) {
      return NextResponse.json({
        ok: false,
        latencyMs,
        status: res.status,
        error: "Provider returned no completion choices for this model",
      });
    }

    return NextResponse.json({ ok: true, latencyMs, error: null, status: res.status });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
