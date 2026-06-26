import { jwtVerify } from "jose";
import { NextResponse } from "next/server";
import { getSettings } from "@/lib/localDb";
import { getConsistentMachineId } from "@/shared/utils/machineId";

const SECRET: any = new TextEncoder().encode(process.env.JWT_SECRET || "pod-default-secret-change-me");

const CLI_TOKEN_HEADER: any = "x-9r-cli-token";
const CLI_TOKEN_SALT: any = "9r-cli-auth";

let cachedCliToken: any = null;
async function getCliToken() {
  if (!cachedCliToken) cachedCliToken = await getConsistentMachineId(CLI_TOKEN_SALT);
  return cachedCliToken;
}

async function hasValidCliToken(request: any) {
  const token: any = request.headers.get(CLI_TOKEN_HEADER);
  if (!token) return false;
  return token === (await getCliToken());
}

// Always require JWT token regardless of requireLogin setting
const ALWAYS_PROTECTED: any = [
  "/api/shutdown",
  "/api/restart",
  "/api/settings/database",
  "/api/settings/migrate-sqlite",
];

// Require explicit dashboard auth even when requireLogin=false.
const STRICT_PROTECTED_API_PATHS: any = [
  "/api/cloud/auth",
  "/api/cloud/credentials/update",
  "/api/oauth",
  "/api/oauth/cursor/auto-import",
  "/api/oauth/cursor/import",
  "/api/oauth/kiro/auto-import",
  "/api/oauth/kiro/import",
  "/api/oauth/kiro/social-authorize",
  "/api/oauth/kiro/social-exchange",
  "/api/providers",
  "/api/provider-nodes",
  "/api/memory",
  "/api/usage/request-details",
  "/api/usage/request-logs",
  "/api/pricing",
  "/api/proxy-pools",
  "/api/combos",
  "/api/tunnel",
];

// Require auth, but allow through if requireLogin is disabled.
const PROTECTED_API_PATHS: any = ["/api/settings", "/api/keys", "/api/cache", "/api/models", "/api/translator"];

async function hasValidToken(request: any) {
  const token: any = request.cookies.get("auth_token")?.value;
  if (!token) return false;
  try {
    await jwtVerify(token, SECRET);
    return true;
  } catch {
    return false;
  }
}

// Read settings directly from DB to avoid self-fetch deadlock in proxy
async function loadSettings() {
  try {
    return await getSettings();
  } catch {
    return null;
  }
}

async function isAuthenticated(request: any) {
  if (await hasValidToken(request)) return true;
  const settings: any = await loadSettings();
  if (settings && settings.requireLogin === false) return true;
  return false;
}

export async function proxy(request: any) {
  const { pathname }: any = request.nextUrl;

  // Always protected - require valid JWT or local CLI token (machineId-based)
  if (ALWAYS_PROTECTED.some((p: any) => pathname.startsWith(p))) {
    if ((await hasValidCliToken(request)) || (await hasValidToken(request))) return NextResponse.next();
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Sensitive admin APIs stay protected even when the dashboard itself is public.
  if (STRICT_PROTECTED_API_PATHS.some((p: any) => pathname.startsWith(p))) {
    if ((await hasValidCliToken(request)) || (await hasValidToken(request))) return NextResponse.next();
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Protect sensitive API endpoints (allow CLI token, JWT, or requireLogin=false)
  if (PROTECTED_API_PATHS.some((p: any) => pathname.startsWith(p))) {
    if (pathname === "/api/settings/require-login") return NextResponse.next();
    if ((await hasValidCliToken(request)) || (await isAuthenticated(request))) return NextResponse.next();
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Protect all dashboard routes (top-level paths served by the (dashboard) layout)
  const DASHBOARD_PATHS: any = [
    "/endpoint",
    "/providers",
    "/combos",
    "/memory",
    "/cache",
    "/usage",
    "/quota",
    "/health",
    "/proxy-pools",
    "/logs",
    "/settings",
    "/translator",
    "/basic-chat",
    "/media-providers",
  ];
  const isDashboardRoute: any = DASHBOARD_PATHS.some((p: any) => pathname === p || pathname.startsWith(p + "/"));
  if (isDashboardRoute) {
    let requireLogin: any = true;
    let tunnelDashboardAccess: any = true;

    try {
      const settings: any = await loadSettings();
      if (settings) {
        requireLogin = settings.requireLogin !== false;
        tunnelDashboardAccess = settings.tunnelDashboardAccess === true;

        // Block tunnel/tailscale access if disabled (redirect to login)
        if (!tunnelDashboardAccess) {
          const host: any = (request.headers.get("host") || "").split(":")[0].toLowerCase();
          const tunnelHost: any = settings.tunnelUrl ? new URL(settings.tunnelUrl).hostname.toLowerCase() : "";
          const tailscaleHost: any = settings.tailscaleUrl ? new URL(settings.tailscaleUrl).hostname.toLowerCase() : "";
          if ((tunnelHost && host === tunnelHost) || (tailscaleHost && host === tailscaleHost)) {
            return NextResponse.redirect(new URL("/login", request.url));
          }
        }
      }
    } catch {
      // On error, keep defaults (require login, block tunnel)
    }

    // If login not required, allow through
    if (!requireLogin) return NextResponse.next();

    // Verify JWT token
    const token: any = request.cookies.get("auth_token")?.value;
    if (token) {
      try {
        await jwtVerify(token, SECRET);
        return NextResponse.next();
      } catch {
        return NextResponse.redirect(new URL("/login", request.url));
      }
    }

    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Redirect / to /endpoint (main dashboard entry point)
  if (pathname === "/") {
    return NextResponse.redirect(new URL("/endpoint", request.url));
  }

  return NextResponse.next();
}

export const config: any = {
  matcher: [
    "/",
    "/endpoint/:path*",
    "/endpoint",
    "/providers/:path*",
    "/providers",
    "/combos/:path*",
    "/combos",
    "/memory/:path*",
    "/memory",
    "/cache/:path*",
    "/cache",
    "/usage/:path*",
    "/usage",
    "/quota/:path*",
    "/quota",
    "/health/:path*",
    "/health",
    "/proxy-pools/:path*",
    "/proxy-pools",
    "/logs/:path*",
    "/logs",
    "/settings/:path*",
    "/settings",
    "/translator/:path*",
    "/translator",
    "/basic-chat/:path*",
    "/basic-chat",
    "/media-providers/:path*",
    "/media-providers",
    "/api/memory",
    "/api/memory/:path*",
    "/api/cloud/auth",
    "/api/cloud/credentials/update",
    "/api/oauth",
    "/api/oauth/:path*",
    "/api/oauth/cursor/auto-import",
    "/api/oauth/cursor/import",
    "/api/oauth/kiro/auto-import",
    "/api/oauth/kiro/import",
    "/api/oauth/kiro/social-authorize",
    "/api/oauth/kiro/social-exchange",
    "/api/providers",
    "/api/providers/:path*",
    "/api/provider-nodes",
    "/api/provider-nodes/:path*",
    "/api/usage",
    "/api/usage/:path*",
    "/api/pricing",
    "/api/pricing/:path*",
    "/api/proxy-pools",
    "/api/proxy-pools/:path*",
    "/api/combos",
    "/api/combos/:path*",
    "/api/cache",
    "/api/cache/:path*",
    "/api/models",
    "/api/models/:path*",
    "/api/translator",
    "/api/translator/:path*",
    "/api/tunnel",
    "/api/tunnel/:path*",
    "/api/settings/:path*",
    "/api/keys",
    "/api/keys/:path*",
  ],
};
