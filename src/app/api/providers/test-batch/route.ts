import { NextResponse } from "next/server";
import { sanitizeError } from "@/lib/sanitizeError";
import { getProviderConnections } from "@/models";
import {
  ANTHROPIC_COMPATIBLE_PREFIX,
  APIKEY_PROVIDERS,
  FREE_PROVIDERS,
  OAUTH_PROVIDERS,
  OPENAI_COMPATIBLE_PREFIX,
} from "@/shared/constants/providers";
import { testSingleConnection } from "../[id]/test/testUtils";
import { parseJsonBody } from "@/lib/parseJsonBody";

function getAuthGroup(providerId: any, connection = null as any) {
  // Prioritize authType from connection if available
  if (connection?.authType) {
    if (connection.authType === "oauth") {
      // Check if it's a free provider
      if (FREE_PROVIDERS[providerId]) return "free";
      return "oauth";
    }
    return connection.authType;
  }

  // Fallback to constants
  if (FREE_PROVIDERS[providerId]) return "free";
  if (OAUTH_PROVIDERS[providerId]) return "oauth";
  if (APIKEY_PROVIDERS[providerId]) return "apikey";
  if (
    typeof providerId === "string" &&
    (providerId.startsWith(OPENAI_COMPATIBLE_PREFIX) || providerId.startsWith(ANTHROPIC_COMPATIBLE_PREFIX))
  )
    return "compatible";
  return "apikey";
}

function isCompatibleProvider(providerId: any) {
  return (
    typeof providerId === "string" &&
    (providerId.startsWith(OPENAI_COMPATIBLE_PREFIX) || providerId.startsWith(ANTHROPIC_COMPATIBLE_PREFIX))
  );
}

// POST /api/providers/test-batch - Test multiple connections by group
export async function POST(request: any) {
  try {
    const [rawBody, _parseErr] = await parseJsonBody(request);
    if (_parseErr) return _parseErr;
    const body = rawBody as Record<string, unknown>;
    const { mode, providerId } = body ?? ({} as any);

    if (!mode) {
      return NextResponse.json({ error: "mode is required" }, { status: 400 });
    }

    const allConnections = await getProviderConnections({ isActive: true });

    let connectionsToTest: any[] = [];
    if (mode === "provider" && providerId) {
      connectionsToTest = allConnections.filter((c: any) => c.provider === providerId);
    } else if (mode === "oauth") {
      connectionsToTest = allConnections.filter((c: any) => getAuthGroup(c.provider, c) === "oauth");
    } else if (mode === "free") {
      connectionsToTest = allConnections.filter((c: any) => getAuthGroup(c.provider, c) === "free");
    } else if (mode === "apikey") {
      connectionsToTest = allConnections.filter((c: any) => getAuthGroup(c.provider, c) === "apikey");
    } else if (mode === "compatible") {
      connectionsToTest = allConnections.filter((c: any) => isCompatibleProvider(c.provider));
    } else if (mode === "all") {
      connectionsToTest = allConnections;
    } else {
      return NextResponse.json(
        { error: "Invalid mode. Use: provider, oauth, free, apikey, compatible, all" },
        { status: 400 },
      );
    }

    if (connectionsToTest.length === 0) {
      return NextResponse.json({
        mode,
        providerId: providerId || null,
        results: [],
        summary: { total: 0, passed: 0, failed: 0 },
        testedAt: new Date().toISOString(),
      });
    }

    const results: any[] = [];
    for (const conn of connectionsToTest) {
      try {
        const data = (await testSingleConnection(conn.id)) as Record<string, unknown>;
        results.push({
          provider: conn.provider,
          connectionId: conn.id,
          connectionName: conn.name || conn.email || conn.provider,
          authType: conn.authType || getAuthGroup(conn.provider, conn),
          valid: data.valid,
          latencyMs: data.latencyMs || 0,
          error: data.error || null,
          diagnosis: data.diagnosis || null,
          statusCode: data.statusCode || null,
          testedAt: data.testedAt || new Date().toISOString(),
        });
      } catch (error) {
        results.push({
          provider: conn.provider,
          connectionId: conn.id,
          connectionName: conn.name || conn.email || conn.provider,
          authType: conn.authType || getAuthGroup(conn.provider, conn),
          valid: false,
          latencyMs: 0,
          error: sanitizeError(error),
          diagnosis: { type: "network_error", source: "local", code: null, message: sanitizeError(error) },
          statusCode: null,
          testedAt: new Date().toISOString(),
        });
      }
    }

    return NextResponse.json({
      mode,
      providerId: providerId || null,
      results,
      testedAt: new Date().toISOString(),
      summary: {
        total: results.length,
        passed: results.filter((r: any) => r.valid).length,
        failed: results.filter((r: any) => !r.valid).length,
      },
    });
  } catch (error) {
    console.log("Error in batch test:", error);
    return NextResponse.json({ error: "Batch test failed" }, { status: 500 });
  }
}
