import { connect } from "cloudflare:sockets";

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

const FORWARD_RAW_TIMEOUT_MS = 15000;

// Forward request via raw TCP socket (bypasses CF auto headers) - authenticated
export async function handleForwardRaw(request) {
  try {
    const { extractBearerToken, parseApiKey } = await import("../utils/apiKey.js");

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

    const url = new URL(targetUrl);
    const host = url.hostname;
    const port = url.port || (url.protocol === "https:" ? 443 : 80);
    const path = url.pathname + url.search;
    const isHttps = url.protocol === "https:";

    console.log("[FORWARD_RAW] Connecting to:", host, port, isHttps ? "(TLS)" : "");

    // Connect to target server
    let secureSocket;
    if (isHttps) {
      secureSocket = connect({
        hostname: host,
        port: parseInt(port),
        secureTransport: "on"
      });
    } else {
      secureSocket = connect({ hostname: host, port: parseInt(port) });
    }

    try {
      await secureSocket.opened;
    } catch (openError) {
      console.error("[FORWARD_RAW] Socket open error:", openError.message);
      throw openError;
    }

    const writer = secureSocket.writable.getWriter();
    const reader = secureSocket.readable.getReader();

    // Build raw HTTP request
    const bodyStr = JSON.stringify(body);
    const requestHeaders = {
      "Host": host,
      "Content-Type": "application/json",
      "Content-Length": new TextEncoder().encode(bodyStr).length.toString(),
      "Connection": "close",
      ...headers
    };

    let httpRequest = `POST ${path} HTTP/1.1\r\n`;
    for (const [key, value] of Object.entries(requestHeaders)) {
      httpRequest += `${key}: ${value}\r\n`;
    }
    httpRequest += `\r\n${bodyStr}`;

    console.log("[FORWARD_RAW] Request length:", httpRequest.length);

    try {
      await writer.write(new TextEncoder().encode(httpRequest));
      await writer.close();
    } catch (writeError) {
      console.error("[FORWARD_RAW] Write error:", writeError.message);
      throw writeError;
    }

    // Read response with timeout
    let responseData = new Uint8Array(0);
    let attempts = 0;
    const maxAttempts = 100;
    const readStartTime = Date.now();

    while (attempts < maxAttempts) {
      // Timeout guard: abort after FORWARD_RAW_TIMEOUT_MS
      if (Date.now() - readStartTime > FORWARD_RAW_TIMEOUT_MS) {
        console.warn("[FORWARD_RAW] Read timeout after", FORWARD_RAW_TIMEOUT_MS, "ms");
        break;
      }

      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        const newData = new Uint8Array(responseData.length + value.length);
        newData.set(responseData);
        newData.set(value, responseData.length);
        responseData = newData;

        const text = new TextDecoder().decode(responseData);
        if (text.includes("\r\n\r\n")) {
          const headerEnd = text.indexOf("\r\n\r\n");
          const headersPart = text.substring(0, headerEnd).toLowerCase();
          const contentLengthMatch = headersPart.match(/content-length:\s*(\d+)/);
          if (contentLengthMatch) {
            const expectedLength = parseInt(contentLengthMatch[1]);
            const bodyReceived = text.length - headerEnd - 4;
            if (bodyReceived >= expectedLength) {
              console.log("[FORWARD_RAW] Complete response received");
              break;
            }
          }
        }
      }
      attempts++;
    }

    console.log("[FORWARD_RAW] Total bytes:", responseData.length);

    const responseText = new TextDecoder().decode(responseData);

    const headerEndIndex = responseText.indexOf("\r\n\r\n");
    if (headerEndIndex === -1) {
      throw new Error("Invalid HTTP response - no header end found");
    }

    const headerPart = responseText.substring(0, headerEndIndex);
    const bodyPart = responseText.substring(headerEndIndex + 4);

    const statusLine = headerPart.split("\r\n")[0];
    const statusMatch = statusLine.match(/HTTP\/[\d.]+ (\d+)/);
    const status = statusMatch ? parseInt(statusMatch[1]) : 200;

    const responseHeaders = {};
    const headerLines = headerPart.split("\r\n").slice(1);
    for (const line of headerLines) {
      const colonIndex = line.indexOf(":");
      if (colonIndex > 0) {
        const key = line.substring(0, colonIndex).trim();
        const value = line.substring(colonIndex + 1).trim();
        responseHeaders[key.toLowerCase()] = value;
      }
    }

    return new Response(bodyPart, {
      status,
      headers: {
        "Content-Type": responseHeaders["content-type"] || "application/json",
        "Access-Control-Allow-Origin": "*"
      }
    });

  } catch (error) {
    console.error("[FORWARD_RAW] Error:", error.message, error.stack);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
    });
  }
}

