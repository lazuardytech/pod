import { NextResponse } from "next/server";
import { createProviderConnection } from "@/models";
import { getProviderConnections } from "@/lib/localDb";
import { validateFetchUrl } from "@/lib/validateUrl";

const GITLAB_DEFAULT_BASE = "https://gitlab.com";

/**
 * POST /api/oauth/gitlab/pat
 * Authenticate GitLab Duo with a Personal Access Token (PAT)
 */
export async function POST(request) {
  try {
    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    const { token, baseUrl } = body;
    if (!token?.trim()) {
      return NextResponse.json({ error: "Personal Access Token is required" }, { status: 400 });
    }

    const base = (baseUrl?.trim() || GITLAB_DEFAULT_BASE).replace(/\/$/, "");

    // Validate the GitLab base URL — must be http/https and not a private address
    const urlCheck = validateFetchUrl(base);
    if (!urlCheck.ok) {
      return NextResponse.json({ error: `Invalid GitLab base URL: ${urlCheck.error}` }, { status: 400 });
    }

    // Hostname allowlist: gitlab.com + its subdomains, or an existing provider connection.
    const parsedHost = urlCheck.url.hostname.toLowerCase();
    const isGitLabHosted =
      parsedHost === "gitlab.com" || parsedHost === "www.gitlab.com" || parsedHost.endsWith(".gitlab.com");
    if (!isGitLabHosted) {
      // Allow self-hosted GitLab instances the user has already configured as a provider connection
      const existingConnections = await getProviderConnections({ provider: "gitlab" }).catch(() => []);
      const hasExisting = existingConnections.some((conn) => {
        const connBase = conn.providerSpecificData?.baseUrl;
        if (!connBase) return false;
        try {
          return new URL(connBase).hostname.toLowerCase() === parsedHost;
        } catch {
          return false;
        }
      });
      if (!hasExisting) {
        return NextResponse.json(
          { error: "GitLab base URL must be gitlab.com or match an existing GitLab provider connection" },
          { status: 400 },
        );
      }
    }

    // base is validated by validateFetchUrl above and hostname allowlist. lgtm[js/request-forgery]
    const userRes = await fetch(`${base}/api/v4/user`, {
      // lgtm[js/request-forgery]
      headers: { "Private-Token": token.trim(), Accept: "application/json" },
    });

    if (!userRes.ok) {
      const err = await userRes.text();
      return NextResponse.json({ error: `GitLab token verification failed: ${err}` }, { status: 401 });
    }

    const user = await userRes.json();
    const email = user.email || user.public_email || "";

    await createProviderConnection({
      provider: "gitlab",
      authType: "oauth",
      accessToken: token.trim(),
      refreshToken: null,
      expiresAt: null,
      email,
      displayName: user.name || user.username || email,
      testStatus: "active",
      providerSpecificData: {
        username: user.username || "",
        email,
        name: user.name || "",
        baseUrl: base,
        authKind: "personal_access_token",
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("GitLab PAT auth error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
