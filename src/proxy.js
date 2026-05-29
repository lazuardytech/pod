export { proxy } from "./dashboardGuard";

export const config = {
  matcher: [
    "/",
    "/endpoint/:path*",
    "/providers/:path*",
    "/combos/:path*",
    "/memory/:path*",
    "/cache/:path*",
    "/usage/:path*",
    "/quota/:path*",
    "/health/:path*",
    "/proxy-pools/:path*",
    "/logs/:path*",
    "/settings/:path*",
    "/translator/:path*",
    "/basic-chat/:path*",
    "/media-providers/:path*",
    "/api/shutdown",
    "/api/restart",
    "/api/settings/:path*",
    "/api/keys",
    "/api/keys/:path*",
    "/api/providers/client",
    "/api/provider-nodes/validate",
  ],
};
