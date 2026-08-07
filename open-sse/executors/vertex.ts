import { PROVIDERS } from "../config/providers.js";
import { parseVertexSaJson, refreshVertexToken } from "../services/tokenRefresh.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import {
  BaseExecutor,
  type ExecutorConfigInput,
  type ExecutorCredentials,
  type ExecutorExecuteOptions,
  type ExecutorExecuteResult,
  type ExecutorHeaders,
  type ExecutorLogger,
} from "./base.js";

// Cache project IDs resolved from raw API keys { apiKey → projectId }
const projectIdCache = new Map<string, string>();

/**
 * Resolve GCP project ID from a raw Vertex API key.
 * Sends a dummy 404 request and parses "projects/{id}" from the error message.
 */
async function resolveProjectId(apiKey: string): Promise<string | null> {
  if (projectIdCache.has(apiKey)) return projectIdCache.get(apiKey) ?? null;

  const res = await fetch(
    `https://aiplatform.googleapis.com/v1/publishers/google/models/__probe__:generateContent?key=${apiKey}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
  );
  const json = (await res.json().catch(() => null)) as
    | { error?: { message?: string } }
    | Array<{ error?: { message?: string } }>
    | null;
  const msg =
    (Array.isArray(json) ? json[0]?.error?.message : json?.error?.message) || "";
  const match = msg.match(/projects\/([^/]+)\//);
  const projectId = match?.[1] || null;

  if (projectId) projectIdCache.set(apiKey, projectId);
  return projectId;
}

function providerDataString(
  credentials: ExecutorCredentials | null | undefined,
  key: string,
): string | undefined {
  const value = credentials?.providerSpecificData?.[key];
  return typeof value === "string" ? value : undefined;
}

/**
 * VertexExecutor - Google Cloud Vertex AI
 *
 * "vertex"         → Gemini models via regional/global Vertex endpoint
 * "vertex-partner" → Partner models (Llama, Mistral, GLM, DeepSeek, Qwen)
 *                    via global OpenAI-compatible endpoint
 *
 * Auth: SA JSON (stored as apiKey) → JWT assertion → Bearer token (via jose)
 * Token is minted/cached in tokenRefresh.js, not here.
 */
export class VertexExecutor extends BaseExecutor {
  constructor(providerId: string = "vertex") {
    super(
      providerId,
      (PROVIDERS as Record<string, ExecutorConfigInput | undefined>)[providerId] || {},
    );
  }

  buildUrl(
    model: string,
    stream: boolean,
    urlIndex: number = 0,
    credentials: ExecutorCredentials | null = null,
  ): string {
    void urlIndex;
    const saJson = parseVertexSaJson(credentials?.apiKey);
    const rawKey = !saJson ? credentials?.apiKey : null;
    const projectId = saJson?.project_id || providerDataString(credentials, "projectId");

    if (this.provider === "vertex-partner") {
      // Partner models require project_id in path regardless of auth method
      if (!projectId)
        throw new Error(
          "Vertex partner models require a project_id. Add it in providerSpecificData or use Service Account JSON.",
        );
      const url = `https://aiplatform.googleapis.com/v1/projects/${projectId}/locations/global/endpoints/openapi/chat/completions`;
      return rawKey ? `${url}?key=${rawKey}` : url;
    }

    // Gemini on Vertex
    const action = stream ? "streamGenerateContent" : "generateContent";

    if (saJson) {
      // SA JSON + Bearer token: must use project-scoped path to avoid RESOURCE_PROJECT_INVALID
      const location = providerDataString(credentials, "location") || "us-central1";
      let url = `https://aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:${action}`;
      if (stream) url += "?alt=sse";
      return url;
    }

    // Raw API key: use global publishers endpoint with ?key= param
    // ?alt=sse is required for proper SSE streaming (matches every other Gemini executor)
    let url = `https://aiplatform.googleapis.com/v1/publishers/google/models/${model}:${action}`;
    if (stream) url += "?alt=sse";
    if (rawKey) url += stream ? `&key=${rawKey}` : `?key=${rawKey}`;
    return url;
  }

  buildHeaders(credentials: ExecutorCredentials, stream: boolean = true): ExecutorHeaders {
    const headers: ExecutorHeaders = { "Content-Type": "application/json" };

    // Only set Bearer token if using SA JSON flow (raw key goes in URL ?key=)
    if (credentials.accessToken) {
      headers["Authorization"] = `Bearer ${credentials.accessToken}`;
    }

    if (stream) headers["Accept"] = "text/event-stream";

    return headers;
  }

  async refreshCredentials(
    credentials: ExecutorCredentials,
    log: ExecutorLogger | null,
  ): Promise<ExecutorCredentials | null> {
    const saJson = parseVertexSaJson(credentials?.apiKey);
    if (!saJson) return null;

    const result = await refreshVertexToken(saJson, log);
    if (!result) return null;

    return { accessToken: result.accessToken, expiresAt: result.expiresAt };
  }

  async execute({
    model,
    body,
    stream,
    credentials,
    signal,
    log,
    proxyOptions = null,
  }: ExecutorExecuteOptions): Promise<ExecutorExecuteResult> {
    const saJson = parseVertexSaJson(credentials?.apiKey);

    // SA JSON flow: mint Bearer token (cached)
    if (saJson) {
      const result = await refreshVertexToken(saJson, log ?? null);
      if (!result?.accessToken)
        throw new Error("Vertex: failed to mint access token from Service Account JSON");
      credentials.accessToken = result.accessToken;
    }

    // vertex-partner with raw key: auto-resolve project_id if not provided
    if (
      this.provider === "vertex-partner" &&
      !saJson &&
      !providerDataString(credentials, "projectId")
    ) {
      const projectId = await resolveProjectId(credentials.apiKey as string);
      if (!projectId)
        throw new Error(
          "Vertex: could not resolve project_id from API key. Please add it manually in provider settings.",
        );
      log?.debug?.("VERTEX", `Resolved project_id: ${projectId}`);
      credentials.providerSpecificData = { ...credentials.providerSpecificData, projectId };
    }

    const url = this.buildUrl(model, stream, 0, credentials);
    const headers = this.buildHeaders(credentials, stream);
    const transformedBody = this.transformRequest(model, body, stream, credentials);

    const response = await proxyAwareFetch(
      url,
      {
        method: "POST",
        headers,
        body: JSON.stringify(transformedBody),
        signal,
      },
      proxyOptions,
    );

    return { response, url, headers, transformedBody };
  }
}

export default VertexExecutor;
