import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { asString, fetchUrlError } from "@/app/api/_types";
import { parseJsonBody } from "@/lib/parseJsonBody";
import { sanitizeError } from "@/lib/sanitizeError";
import { validateFetchUrl } from "@/lib/validateUrl";
import { createProxyPool } from "@/models";

const VERCEL_API = "https://api.vercel.com";

function sanitizeProxyPool(pool: any) {
  if (!pool) return pool;
  const sanitized = { ...pool };
  delete sanitized.relayAuthToken;
  return sanitized;
}

function createRelayFunctionCode(relayAuthToken: any) {
  return `
const RELAY_AUTH_TOKEN = ${JSON.stringify(relayAuthToken)};

export default async function handler(req) {
  const relayAuth = req.headers.get("x-relay-auth");
  if (relayAuth !== RELAY_AUTH_TOKEN) {
    return new Response(JSON.stringify({ error: "Unauthorized relay request" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  const target = req.headers.get("x-relay-target");
  const relayPath = req.headers.get("x-relay-path") || "/";
  if (!target) {
    return new Response(JSON.stringify({ error: "Missing x-relay-target header" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const targetUrl = target.replace(/\\/$/, "") + relayPath;

  // Read relay timeout from header (configurable at request time, no hardcoding)
  const timeoutMs = parseInt(req.headers.get("x-relay-timeout"), 10) || 0;
  let controller, timeoutId;
  if (timeoutMs > 0) {
    controller = new AbortController();
    timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  }

  const headers = new Headers(req.headers);
  headers.delete("x-relay-auth");
  headers.delete("x-relay-target");
  headers.delete("x-relay-path");
  headers.delete("x-relay-timeout");
  headers.delete("host");

  try {
    const response = await fetch(targetUrl, {
      method: req.method,
      headers,
      body: req.method !== "GET" && req.method !== "HEAD" ? req.body : undefined,
      duplex: "half",
      ...(controller ? { signal: controller.signal } : {}),
    });
    if (timeoutId) clearTimeout(timeoutId);
    return new Response(response.body, {
      status: response.status,
      headers: response.headers,
    });
  } catch (err) {
    if (timeoutId) clearTimeout(timeoutId);
    const isTimeout = controller && controller.signal.aborted;
    return new Response(JSON.stringify({
      error: isTimeout ? "Upstream relay request timed out" : ((err as any).message || "Relay error")
    }), {
      status: 504,
      headers: { "content-type": "application/json" },
    });
  }
}
`;
}

async function pollDeployment(deploymentId: any, token: any, maxMs: number = 120000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const res = await fetch(`${VERCEL_API}/v13/deployments/${deploymentId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (data.readyState === "READY") return data;
    if (data.readyState === "ERROR" || data.readyState === "CANCELED") {
      throw new Error(`Deployment failed: ${data.readyState}`);
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error("Deployment timed out");
}

// POST /api/proxy-pools/vercel-deploy
export async function POST(request: any) {
  try {
    const [rawBody, _parseErr] = await parseJsonBody(request);
    if (_parseErr) return _parseErr;
    const body = rawBody as Record<string, unknown>;
    const vercelToken = body.vercelToken;
    const projectName = asString(body.projectName).trim() || `relay-${Date.now().toString(36)}`;

    if (!vercelToken) {
      return NextResponse.json({ error: "Vercel API token is required" }, { status: 400 });
    }

    const relayAuthToken = randomBytes(24).toString("hex");

    // Deploy relay function to Vercel
    const deployRes = await fetch(`${VERCEL_API}/v13/deployments`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${vercelToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: projectName,
        files: [
          {
            file: "api/relay.js",
            data: createRelayFunctionCode(relayAuthToken),
          },
          {
            file: "package.json",
            data: JSON.stringify({ name: projectName, version: "1.0.0" }),
          },
          {
            file: "vercel.json",
            data: JSON.stringify({
              rewrites: [{ source: "/(.*)", destination: "/api/relay" }],
            }),
          },
        ],
        projectSettings: {
          framework: null,
        },
        target: "production",
      }),
    });

    if (!deployRes.ok) {
      return NextResponse.json({ error: "Failed to create Vercel deployment" }, { status: deployRes.status });
    }

    const deployment = await deployRes.json();
    const deploymentId = deployment.id || deployment.uid;

    // Disable deployment protection (Vercel Authentication)
    const projectId = deployment.projectId || projectName;
    // VERCEL_API is a hardcoded constant, not user-supplied. lgtm[js/request-forgery]
    await fetch(`${VERCEL_API}/v9/projects/${projectId}`, {
      // lgtm[js/request-forgery]
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${vercelToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ssoProtection: null }),
    });

    // Poll until deployment is ready
    const ready = await pollDeployment(deploymentId, vercelToken);
    const deployUrl = `https://${ready.url}`;

    // Validate the deploy URL returned by Vercel before storing
    const urlCheck = validateFetchUrl(deployUrl);
    if (!urlCheck.ok) {
      throw new Error(`Invalid deployment URL from Vercel: ${fetchUrlError(urlCheck)}`);
    }

    // Create proxy pool entry with type vercel
    const proxyPool = await createProxyPool({
      name: projectName,
      proxyUrl: deployUrl,
      type: "vercel",
      noProxy: "",
      isActive: true,
      strictProxy: false,
      relayAuthToken,
    });

    return NextResponse.json({ proxyPool: sanitizeProxyPool(proxyPool), deployUrl }, { status: 201 });
  } catch (error) {
    console.log("Error deploying Vercel relay:", error);
    return NextResponse.json({ error: sanitizeError(error) || "Deploy failed" }, { status: 500 });
  }
}
