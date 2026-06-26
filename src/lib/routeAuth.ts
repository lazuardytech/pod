import { jwtVerify } from "jose";
import { NextResponse } from "next/server";
import { getSettings, validateApiKey } from "@/lib/localDb";
import { extractApiKey } from "@/sse/services/auth.js";
import { getConsistentMachineId } from "@/shared/utils/machineId";

const SECRET = new TextEncoder().encode(process.env.JWT_SECRET || "pod-default-secret-change-me");

export const CLI_TOKEN_HEADER = "x-9r-cli-token";
const CLI_TOKEN_SALT = "9r-cli-auth";

let cachedCliToken: string | null = null;

async function getCliToken(): Promise<string> {
  if (!cachedCliToken) cachedCliToken = await getConsistentMachineId(CLI_TOKEN_SALT);
  return cachedCliToken;
}

function unauthorized(message: string = "Unauthorized"): NextResponse {
  return NextResponse.json({ error: message }, { status: 401 });
}

export async function hasValidCliToken(request: Request): Promise<boolean> {
  const token = request?.headers?.get?.(CLI_TOKEN_HEADER);
  if (!token) return false;
  return token === (await getCliToken());
}

type CookieReader = { cookies?: { get?: (name: string) => { value?: string } | undefined } };

export async function hasValidToken(request: Request | (Request & CookieReader)): Promise<boolean> {
  const token = (request as Request & CookieReader)?.cookies?.get?.("auth_token")?.value;
  if (!token) return false;
  try {
    await jwtVerify(token, SECRET);
    return true;
  } catch {
    return false;
  }
}

export async function loadSettingsSafe(): Promise<Awaited<ReturnType<typeof getSettings>> | null> {
  try {
    return await getSettings();
  } catch {
    return null;
  }
}

export async function checkStrictDashboardAuth(request: Request): Promise<NextResponse | null> {
  if (!request || typeof request.headers?.get !== "function") return unauthorized();
  if ((await hasValidCliToken(request)) || (await hasValidToken(request))) return null;
  return unauthorized();
}

export async function checkDashboardApiAuth(
  request: Request,
  { allowWhenLoginDisabled = true }: { allowWhenLoginDisabled?: boolean } = {},
): Promise<NextResponse | null> {
  if (!request || typeof request.headers?.get !== "function") return unauthorized();
  if ((await hasValidCliToken(request)) || (await hasValidToken(request))) return null;

  if (allowWhenLoginDisabled) {
    const settings = await loadSettingsSafe();
    if (settings?.requireLogin === false) return null;
  }

  return unauthorized();
}

export type RequireValidApiKeyResult = { apiKey: string | null; response: NextResponse | null };

export async function requireValidApiKey(request: Request): Promise<RequireValidApiKeyResult> {
  if (!request || typeof request.headers?.get !== "function") {
    return { apiKey: null, response: unauthorized() };
  }

  const apiKey = extractApiKey(request);
  if (!apiKey) {
    return { apiKey: null, response: NextResponse.json({ error: "Missing API key" }, { status: 401 }) };
  }

  try {
    const valid = await validateApiKey(apiKey);
    if (valid) return { apiKey, response: null };
  } catch {
    // Fall through to a generic invalid-key response.
  }

  return { apiKey: null, response: NextResponse.json({ error: "Invalid API key" }, { status: 401 }) };
}
