import bcrypt from "bcryptjs";
import { SignJWT } from "jose";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { asString } from "@/app/api/_types";
import { getSettings } from "@/lib/localDb";
import { parseJsonBody } from "@/lib/parseJsonBody";
import { sanitizeError } from "@/lib/sanitizeError";

const SECRET = new TextEncoder().encode(process.env.JWT_SECRET || "pod-default-secret-change-me");

function isTunnelRequest(request: any, settings: any) {
  const host = (request.headers.get("host") || "").split(":")[0].toLowerCase();
  const tunnelHost = settings.tunnelUrl ? new URL(settings.tunnelUrl).hostname.toLowerCase() : "";
  const tailscaleHost = settings.tailscaleUrl
    ? new URL(settings.tailscaleUrl).hostname.toLowerCase()
    : "";
  return (tunnelHost && host === tunnelHost) || (tailscaleHost && host === tailscaleHost);
}

export async function POST(request: any) {
  try {
    const [rawBody, _parseErr] = await parseJsonBody(request);
    if (_parseErr) return _parseErr;
    const body = rawBody as Record<string, unknown>;
    const password = asString(body.password);
    const settings = await getSettings();

    // Block login via tunnel/tailscale if dashboard access is disabled
    if (isTunnelRequest(request, settings) && settings.tunnelDashboardAccess !== true) {
      return NextResponse.json(
        { error: "Dashboard access via tunnel is disabled" },
        { status: 403 },
      );
    }

    // Default password is '123456' if not set
    const storedHash = settings.password as string | undefined;

    let isValid = false;
    if (storedHash) {
      isValid = await bcrypt.compare(password, storedHash as string);
    } else {
      const initialPassword = process.env.INITIAL_PASSWORD;
      if (!initialPassword) {
        return NextResponse.json({ error: "Server not configured for login" }, { status: 500 });
      }
      isValid = password === initialPassword;
    }

    if (isValid) {
      const forceSecureCookie = process.env.AUTH_COOKIE_SECURE === "true";
      const forwardedProto = request.headers.get("x-forwarded-proto");
      const isHttpsRequest = forwardedProto === "https";
      const useSecureCookie = forceSecureCookie || isHttpsRequest;

      const token = await new SignJWT({ authenticated: true })
        .setProtectedHeader({ alg: "HS256" })
        .setExpirationTime("24h")
        .sign(SECRET);

      const cookieStore = await cookies();
      cookieStore.set("auth_token", token, {
        httpOnly: true,
        secure: useSecureCookie,
        sameSite: "lax",
        path: "/",
      });

      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  } catch (error) {
    return NextResponse.json({ error: sanitizeError(error) }, { status: 500 });
  }
}
