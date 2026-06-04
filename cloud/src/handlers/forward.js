// CF headers to remove
const CF_HEADERS = [
  "cf-connecting-ip", "cf-connecting-ip6", "cf-ray", "cf-visitor",
  "cf-ipcountry", "cf-tracking-id", "cf-connecting-ip6-policy",
  "x-real-ip", "x-forwarded-for", "x-forwarded-proto", "x-forwarded-host"
];

// Blocklist: private/internal IP ranges and metadata endpoints
const BLOCKED_HOST_PATTERNS = [
  /^0\.0\.0\.0$/,
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
  /^localhost$/i,
  /^\[::1\]$/,
  /metadata\.google\.internal/i,
  /169\.254\.169\.254/,
];

function isUrlAllowed(targetUrl) {
  try {
    const url = new URL(targetUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    for (const pattern of BLOCKED_HOST_PATTERNS) {
      if (pattern.test(url.hostname)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

// Forward request to any endpoint (authenticated)
export async function handleForward(request) {
  try {
    const { extractBearerToken, parseApiKey } = await import("../utils/apiKey.js");
    const { getMachineData } = await import("../services/storage.js");

    // Auth: require valid API key
    const apiKey = extractBearerToken(request);
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "Missing API key" }), {
        status: 401,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
      });
    }
    const parsed = await parseApiKey(apiKey);
    if (!parsed || !parsed.machineId) {
      return new Response(JSON.stringify({ error: "Invalid API key" }), {
        status: 401,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
      });
    }

    const url = new URL(request.url);
    const clientIp = request.headers.get("CF-Connecting-IP") || "";
    const { targetUrl, headers = {}, body } = await request.json();

    if (!targetUrl) {
      return new Response(JSON.stringify({ error: "targetUrl is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    // URL validation: block internal/private endpoints
    if (!isUrlAllowed(targetUrl)) {
      return new Response(JSON.stringify({ error: "targetUrl is not allowed" }), {
        status: 403,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
      });
    }

    // Filter out CF headers from input
    const cleanHeaders = {};
    for (const [key, value] of Object.entries(headers)) {
      if (!CF_HEADERS.includes(key.toLowerCase())) {
        cleanHeaders[key] = value;
      }
    }

    // Set standard forwarding headers
    cleanHeaders["X-Client-IP"] = clientIp;
    cleanHeaders["X-Forwarded-Proto"] = url.protocol.replace(":", "");
    cleanHeaders["X-Forwarded-Host"] = url.host;
    cleanHeaders["X-From-Worker"] = "1";

    console.log("[FORWARD] Target:", targetUrl);
    console.log("[FORWARD] Headers:", JSON.stringify(cleanHeaders));

    // Create Request object to have more control over headers
    const outgoingRequest = new Request(targetUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...cleanHeaders
      },
      body: JSON.stringify(body)
    });

    // Use fetch with cf options to minimize auto-added headers
    const response = await fetch(outgoingRequest, {
      cf: {
        // Disable automatic features that add headers
        scrapeShield: false,
        minify: false,
        mirage: false,
        polish: "off"
      }
    });

    // Stream response back to client
    return new Response(response.body, {
      status: response.status,
      headers: {
        "Content-Type": response.headers.get("Content-Type") || "application/json",
        "Access-Control-Allow-Origin": "*"
      }
    });
  } catch (error) {
    console.error("[FORWARD] Error:", error.message);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
    });
  }
}
