import { NextResponse } from "next/server";
import { KiroService } from "@/lib/oauth/services/kiro";
import { parseJsonBody } from "@/lib/parseJsonBody";

import { checkStrictDashboardAuth } from "@/lib/routeAuth";
import { sanitizeError } from "@/lib/sanitizeError";
import { createProviderConnection } from "@/models";
/**
 * POST /api/oauth/kiro/import
 * Import and validate refresh token from Kiro IDE
 */
export async function POST(request: any) {
  try {
    const authResponse = await checkStrictDashboardAuth(request);
    if (authResponse) return authResponse;

    const [rawBody, _parseErr] = await parseJsonBody(request);
    if (_parseErr) return _parseErr;
    const body = rawBody as Record<string, unknown>;
    const { refreshToken } = body ?? ({} as any);

    if (!refreshToken || typeof refreshToken !== "string") {
      return NextResponse.json({ error: "Refresh token is required" }, { status: 400 });
    }

    const kiroService = new KiroService();

    // Validate and refresh token
    const tokenData = await kiroService.validateImportToken(refreshToken.trim());

    // Extract email from JWT if available
    const email = kiroService.extractEmailFromJWT(tokenData.accessToken);

    // Save to database
    const connection = await createProviderConnection({
      provider: "kiro",
      authType: "oauth",
      accessToken: tokenData.accessToken,
      refreshToken: tokenData.refreshToken,
      expiresAt: new Date(Date.now() + tokenData.expiresIn * 1000).toISOString(),
      email: email || null,
      providerSpecificData: {
        profileArn: tokenData.profileArn,
        authMethod: "imported",
        provider: "Imported",
      },
      testStatus: "active",
    });

    return NextResponse.json({
      success: true,
      connection: {
        id: connection.id,
        provider: connection.provider,
        email: connection.email,
      },
    });
  } catch (error) {
    console.log("Kiro import token error:", error);
    return NextResponse.json({ error: sanitizeError(error) }, { status: 500 });
  }
}
