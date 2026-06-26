import { getExecutor, refreshTokenByProvider } from "open-sse/index.js";
import { asApiRecord, asString } from "@/app/api/_types";
import { getProviderConnections } from "@/lib/localDb";
import { parseJsonBody } from "@/lib/parseJsonBody";
import { sanitizeError } from "@/lib/sanitizeError";

function buildForwardHeaders(response: any, stream: any) {
  const headers = new Headers();
  const contentType = response.headers.get("content-type");
  const cacheControl = response.headers.get("cache-control");
  const accelBuffering = response.headers.get("x-accel-buffering");

  if (contentType) {
    headers.set("Content-Type", contentType);
  } else if (stream) {
    headers.set("Content-Type", "text/event-stream");
  } else {
    headers.set("Content-Type", "application/json");
  }

  if (cacheControl) {
    headers.set("Cache-Control", cacheControl);
  } else if (stream) {
    headers.set("Cache-Control", "no-cache");
  }

  if (stream) {
    headers.set("Connection", "keep-alive");
  }

  if (accelBuffering) {
    headers.set("X-Accel-Buffering", accelBuffering);
  }

  return headers;
}

export async function POST(request: any) {
  try {
    const [json, _parseErr] = await parseJsonBody(request);
    if (_parseErr) return _parseErr;
    const rawBody = json;
    const body = rawBody as Record<string, unknown>;
    const provider = asString(body.provider);
    const model = asString(body.model);
    const requestBody = body.body;

    if (!provider || !model || !requestBody) {
      return Response.json({ success: false, error: "provider, model, and body required" }, { status: 400 });
    }

    const connections = await getProviderConnections({ provider });
    const connection = connections.find((c) => c.isActive !== false);
    if (!connection) {
      return Response.json(
        { success: false, error: `No active connection for provider: ${provider}` },
        { status: 400 },
      );
    }

    const credentials = {
      apiKey: connection.apiKey,
      accessToken: connection.accessToken,
      refreshToken: connection.refreshToken,
      copilotToken: connection.copilotToken,
      projectId: connection.projectId,
      providerSpecificData: connection.providerSpecificData,
    };

    const executor = getExecutor(provider) as {
      execute: (opts: Record<string, unknown>) => Promise<{ response: Response }>;
    };
    const reqBody = asApiRecord(requestBody);
    const stream = reqBody.stream === true;

    let { response } = await executor.execute({ model, body: requestBody, stream, credentials });

    // Auto-refresh token on 401/403 and retry (same as chatCore.js)
    if (response.status === 401 || response.status === 403) {
      const newCredentials = (await refreshTokenByProvider(provider, credentials)) as Record<string, unknown> | null;
      if (newCredentials?.accessToken || newCredentials?.copilotToken) {
        Object.assign(credentials, newCredentials);
        ({ response } = await executor.execute({ model, body: requestBody, stream, credentials }));
      }
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Translator] Provider error ${response.status}:`, errorText.slice(0, 500));
      return Response.json(
        { success: false, error: `Provider error: ${response.status}` },
        { status: response.status },
      );
    }

    if (!response.body) {
      return Response.json({ success: false, error: "Provider returned empty response body" }, { status: 502 });
    }

    return new Response(response.body, {
      status: response.status,
      headers: buildForwardHeaders(response, stream),
    });
  } catch (error) {
    console.error("[Translator] Send error:", error);
    return Response.json({ success: false, error: sanitizeError(error) }, { status: 500 });
  }
}
