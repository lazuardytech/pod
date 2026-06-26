import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { NextResponse } from "next/server";

import { checkStrictDashboardAuth } from "@/lib/routeAuth";
import { sanitizeError } from "@/lib/sanitizeError";
/**
 * GET /api/oauth/kiro/auto-import
 * Auto-detect and extract Kiro refresh token from AWS SSO cache
 */
export async function GET(request: any) {
  try {
    const authResponse = await checkStrictDashboardAuth(request);
    if (authResponse) return authResponse;

    const cachePath = join(homedir(), ".aws/sso/cache");

    // Try to read cache directory
    let files;
    try {
      files = await readdir(cachePath);
    } catch (_error) {
      return NextResponse.json({
        found: false,
        error: "AWS SSO cache not found. Please login to Kiro IDE first.",
      });
    }

    // Look for kiro-auth-token.json or any .json file with refreshToken
    let refreshToken = null;
    let foundFile: string | null = null;

    // First try kiro-auth-token.json
    const kiroTokenFile = "kiro-auth-token.json";
    if (files.includes(kiroTokenFile)) {
      try {
        const content = await readFile(join(cachePath, kiroTokenFile), "utf-8");
        const data = JSON.parse(content);
        if (data.refreshToken && data.refreshToken.startsWith("aorAAAAAG")) {
          refreshToken = data.refreshToken;
          foundFile = kiroTokenFile;
        }
      } catch (_error) {
        // Continue to search other files
      }
    }

    // If not found, search all .json files
    if (!refreshToken) {
      for (const file of files) {
        if (!file.endsWith(".json")) continue;

        try {
          const content = await readFile(join(cachePath, file), "utf-8");
          const data = JSON.parse(content);

          // Look for Kiro refresh token (starts with aorAAAAAG)
          if (data.refreshToken && data.refreshToken.startsWith("aorAAAAAG")) {
            refreshToken = data.refreshToken;
            foundFile = file;
            break;
          }
        } catch (_error) {}
      }
    }

    if (!refreshToken) {
      return NextResponse.json({
        found: false,
        error: "Kiro token not found in AWS SSO cache. Please login to Kiro IDE first.",
      });
    }

    return NextResponse.json({
      found: true,
      refreshToken,
      source: foundFile,
    });
  } catch (error) {
    console.log("Kiro auto-import error:", error);
    return NextResponse.json({ found: false, error: sanitizeError(error) }, { status: 500 });
  }
}
