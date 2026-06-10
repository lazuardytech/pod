import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "../..");

function read(relativePath) {
  return fs.readFileSync(path.resolve(repoRoot, relativePath), "utf8");
}

describe("logging audit regressions", () => {
  it("does not log provider token refresh failures with provider-specific text", () => {
    const source = read("src/app/api/providers/[id]/test/testUtils.js");
    expect(source).not.toContain("Error refreshing ${provider} token");
  });

  it("does not log raw Antigravity error messages", () => {
    const source = read("open-sse/services/usage.js");
    expect(source).not.toContain('console.error("[Antigravity Usage] Error:", error.message);');
    expect(source).not.toContain('console.error("[Antigravity Subscription] Error:", error.message);');
  });

  it("does not log raw worker forwarder error messages", () => {
    const forwardSource = read("cloud/src/handlers/forward.js");
    const forwardRawSource = read("cloud/src/handlers/forwardRaw.js");

    expect(forwardSource).not.toContain('console.error("[FORWARD] Error:", error.message);');
    expect(forwardRawSource).not.toContain('console.error("[FORWARD_RAW] Error:", error.message);');
    expect(forwardRawSource).not.toContain('console.error("[FORWARD_RAW] Socket open error:", openError.message);');
    expect(forwardRawSource).not.toContain('console.error("[FORWARD_RAW] Write error:", writeError.message);');
  });

  it("does not log provider or model identifiers in audited chatCore error lines", () => {
    const source = read("open-sse/handlers/chatCore.js");

    expect(source).not.toContain("[VERCEL-RELAY-RETRY] ${provider}/${model}");
    expect(source).not.toContain("[TIMEOUT] ${provider}/${model}");
    expect(source).not.toContain("[UPSTREAM ERROR] ${provider}/${model}");
    expect(source).not.toContain("[VERCEL-RELAY-TIMEOUT] ${provider}/${model}");
    expect(source).not.toContain("[UPSTREAM ${statusCode}] ${provider}/${model}");
  });

  it("does not log raw SSE-to-JSON conversion error messages", () => {
    const source = read("open-sse/handlers/chatCore/sseToJsonHandler.js");

    expect(source).not.toContain(
      'console.error("[ChatCore] Responses API SSE→JSON failed:", err?.message || String(err));',
    );
    expect(source).not.toContain(
      'console.error("[ChatCore] Chat Completions SSE→JSON failed:", err?.message || String(err));',
    );
  });

  it("does not log new provider, model, connection, or raw error details from the follow-up audit", () => {
    const proxyFetchSource = read("open-sse/utils/proxyFetch.js");
    const nonStreamingSource = read("open-sse/handlers/chatCore/nonStreamingHandler.js");
    const streamHandlerSource = read("open-sse/utils/streamHandler.js");
    const providerLimitUtilsSource = read("src/app/(dashboard)/usage/components/ProviderLimits/utils.js");
    const providerLimitIndexSource = read("src/app/(dashboard)/usage/components/ProviderLimits/index.js");
    const authSource = read("src/sse/services/auth.js");
    const usageRouteSource = read("src/app/api/usage/[connectionId]/route.js");

    expect(proxyFetchSource).not.toContain(
      "console.warn(`[ProxyFetch] Proxy failed, falling back to direct: ${proxyError.message}`);",
    );
    expect(nonStreamingSource).not.toContain(
      "console.error(`[ChatCore] Failed to parse Codex SSE from ${provider}:`, err.message);",
    );
    expect(nonStreamingSource).not.toContain(
      "console.error(`[ChatCore] Failed to parse JSON from ${provider}:`, err.message);",
    );
    expect(streamHandlerSource).not.toContain(
      'console.log(`[${getTimeString()}] 🌊 [STREAM] ${p} | ${model || "unknown"} | ${duration}ms | ${status}`);',
    );
    expect(providerLimitUtilsSource).not.toContain(
      "console.error(`Error parsing quota data for ${provider}:`, error);",
    );
    expect(providerLimitIndexSource).not.toContain(
      "console.warn(`[ProviderLimits] Connection not found for ${provider}, skipping`);",
    );
    expect(providerLimitIndexSource).not.toContain(
      "console.warn(`[ProviderLimits] Auth error for ${provider}:`, errorMsg);",
    );
    expect(providerLimitIndexSource).not.toContain(
      "console.error(`[ProviderLimits] Error fetching quota for ${provider} (${connectionId}):`, error);",
    );
    expect(authSource).not.toContain(
      "console.error(`\\u274C ${provider} [${status}] connection lock #${newCount}: ${String(errorText).slice(0, 120)}`);",
    );
    expect(authSource).not.toContain("console.error(`❌ ${provider} [${status}]: ${reason}`);");
    expect(usageRouteSource).not.toContain(
      "console.warn(`[Usage] ${connection.provider}: force refresh failed: ${retryError.message}`);",
    );
    expect(usageRouteSource).not.toContain("console.warn(`[Usage] ${provider}: ${sanitizeError(error)}`);");
  });
});
