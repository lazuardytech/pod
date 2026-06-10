import { NextResponse } from "next/server";
import { KiroService } from "@/lib/oauth/services/kiro";
import { generatePKCE } from "@/lib/oauth/utils/pkce";

import { checkStrictDashboardAuth } from "@/lib/routeAuth.js";
import { sanitizeError } from "@/lib/sanitizeError.js";
/**
 * GET /api/oauth/kiro/social-authorize
 * Generate Google/GitHub social login URL for manual callback flow
 * Uses kiro:// custom protocol as required by AWS Cognito
 */
export async function GET(request) {
  try {
    const authResponse = await checkStrictDashboardAuth(request);
    if (authResponse) return authResponse;

    const { searchParams } = new URL(request.url);
    const provider = searchParams.get("provider"); // "google" or "github"

    if (!provider || !["google", "github"].includes(provider)) {
      return NextResponse.json({ error: "Invalid provider. Use 'google' or 'github'" }, { status: 400 });
    }

    // Generate PKCE for social auth
    const { codeVerifier, codeChallenge, state } = generatePKCE();

    const kiroService = new KiroService();
    const authUrl = kiroService.buildSocialLoginUrl(provider, codeChallenge, state);

    return NextResponse.json({
      authUrl,
      state,
      codeVerifier,
      codeChallenge,
      provider,
    });
  } catch (error) {
    console.log("Kiro social authorize error:", error);
    return NextResponse.json({ error: sanitizeError(error) }, { status: 500 });
  }
}
