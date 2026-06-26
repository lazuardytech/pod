/**
 * Vertex AI Service Account credential test — v0.0.47
 *
 * Exercises real SA JSON parsing, JWT signing (via jose + RSA keypair), region
 * handling, and endpoint URL composition. All offline — mock global.fetch for
 * the OAuth2 token endpoint.
 *
 * Each test that calls refreshVertexToken uses a unique SA email to avoid
 * polluting the in-memory token cache between tests.
 */

import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VertexExecutor } from "../../open-sse/executors/vertex.js";
import { parseVertexSaJson, refreshVertexToken } from "../../open-sse/services/tokenRefresh.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const originalFetch = global.fetch;

let saCounter = 0;

/** Generate a self-signed RSA keypair for JWT tests */
function generateSAJson(overrides = {}) {
  const { privateKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    // pkcs8 = PKCS#8 (-----BEGIN PRIVATE KEY-----) as required by jose.importPKCS8
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  saCounter++;
  return {
    type: "service_account",
    project_id: "my-gcp-project-123",
    private_key_id: `abc${saCounter}`,
    private_key: privateKey,
    client_email: `vertex-sa-${saCounter}@my-gcp-project-123.iam.gserviceaccount.com`,
    client_id: String(saCounter),
    auth_uri: "https://accounts.google.com/o/oauth2/auth",
    token_uri: "https://oauth2.googleapis.com/token",
    ...overrides,
  };
}

/**
 * Decode a JWT payload without verification (for claim inspection).
 * The header+payload are base64url-encoded JSON.
 */
function decodeJWTPayload(jwt) {
  const parts = jwt.split(".");
  if (parts.length !== 3) throw new Error(`Expected 3-part JWT, got ${parts.length} parts`);
  return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
}

// ─── SA JSON Parsing ─────────────────────────────────────────────────────────

describe("parseVertexSaJson", () => {
  it("parses valid SA JSON with all required fields", () => {
    const sa = generateSAJson();
    const result = parseVertexSaJson(JSON.stringify(sa));
    expect(result).not.toBeNull();
    expect(result.type).toBe("service_account");
    expect(result.project_id).toBe("my-gcp-project-123");
    expect(result.client_email).toMatch(/^vertex-sa-\d+@my-gcp-project-123\.iam\.gserviceaccount\.com$/);
    expect(result.private_key).toContain("-----BEGIN PRIVATE KEY-----");
  });

  it("parses SA JSON with optional private_key_id", () => {
    const sa = generateSAJson();
    const result = parseVertexSaJson(JSON.stringify(sa));
    expect(result.private_key_id).toBeTruthy();
  });

  it("returns null when type is not service_account", () => {
    const sa = generateSAJson({ type: "authorized_user" });
    expect(parseVertexSaJson(JSON.stringify(sa))).toBeNull();
  });

  it("returns null when client_email is missing", () => {
    const sa = generateSAJson({ client_email: undefined });
    expect(parseVertexSaJson(JSON.stringify(sa))).toBeNull();
  });

  it("returns null when private_key is missing", () => {
    const sa = generateSAJson({ private_key: undefined });
    expect(parseVertexSaJson(JSON.stringify(sa))).toBeNull();
  });

  it("returns null when project_id is missing", () => {
    const sa = generateSAJson({ project_id: undefined });
    expect(parseVertexSaJson(JSON.stringify(sa))).toBeNull();
  });

  it("returns null for malformed JSON string", () => {
    expect(parseVertexSaJson("{not-json")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseVertexSaJson("")).toBeNull();
  });

  it("returns null for non-string input", () => {
    expect(parseVertexSaJson(null)).toBeNull();
    expect(parseVertexSaJson(undefined)).toBeNull();
    expect(parseVertexSaJson({})).toBeNull();
    expect(parseVertexSaJson(42)).toBeNull();
  });

  it("returns parsed object for malformed PEM content (only field presence validated)", () => {
    const sa = generateSAJson({
      private_key: "-----BEGIN RSA PRIVATE KEY-----\nNOT_BASE64\n-----END RSA PRIVATE KEY-----\n",
    });
    const result = parseVertexSaJson(JSON.stringify(sa));
    // parseVertexSaJson only checks field presence & type — it doesn't validate PEM
    expect(result).not.toBeNull();
    expect(result.private_key).toContain("-----BEGIN RSA PRIVATE KEY-----");
  });

  it("accepts private_key with \\n escape sequences (as received from GCP console copy)", () => {
    const sa = generateSAJson({
      private_key: "-----BEGIN RSA PRIVATE KEY-----\\nMIIEpAIBAAKCAQEA\\n-----END RSA PRIVATE KEY-----\\n",
    });
    const result = parseVertexSaJson(JSON.stringify(sa));
    expect(result).not.toBeNull();
    // The raw string has literal \n (two chars), not actual newlines — that's fine for parsing
    expect(result.private_key).toContain("\\n");
  });
});

// ─── JWT Signing & Claims Verification ──────────────────────────────────────

describe("refreshVertexToken — JWT claims", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("signs JWT with correct iss, aud, scope, exp, iat claims", async () => {
    const sa = generateSAJson();

    global.fetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: "ya29.mock-token", expires_in: 3600 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await refreshVertexToken(sa, null);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const callArgs = global.fetch.mock.calls[0];
    expect(callArgs[0]).toBe("https://oauth2.googleapis.com/token");
    expect(callArgs[1].method).toBe("POST");
    expect(callArgs[1].headers["Content-Type"]).toBe("application/x-www-form-urlencoded");

    const body = new URLSearchParams(callArgs[1].body);
    const capturedAssertion = body.get("assertion");
    expect(capturedAssertion).toBeTruthy();
    expect(body.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");

    // Decode JWT payload
    const payload = decodeJWTPayload(capturedAssertion);
    expect(payload.iss).toBe(sa.client_email);
    expect(payload.aud).toBe("https://oauth2.googleapis.com/token");
    expect(payload.scope).toBe("https://www.googleapis.com/auth/cloud-platform");

    // iat should be recent (within 60s)
    expect(payload.iat).toBeGreaterThan(Math.floor(Date.now() / 1000) - 60);
    expect(payload.iat).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) + 5);

    // exp should be ~3600s after iat
    expect(payload.exp - payload.iat).toBe(3600);

    // Verify returned token
    expect(result.accessToken).toBe("ya29.mock-token");
    expect(result.expiresAt).toBeGreaterThan(Date.now());
  });

  it("uses RS256 algorithm in JWT header", async () => {
    const sa = generateSAJson();

    global.fetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: "ya29.mock-rs256", expires_in: 3600 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await refreshVertexToken(sa, null);

    const callArgs = global.fetch.mock.calls[0];
    const body = new URLSearchParams(callArgs[1].body);
    const assertion = body.get("assertion");
    const header = JSON.parse(Buffer.from(assertion.split(".")[0], "base64url").toString("utf8"));

    expect(header.alg).toBe("RS256");
    // typ is not set by default — only alg is required
  });

  it("returns cached token if still valid", async () => {
    const sa = generateSAJson();

    // First call — mint token
    global.fetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: "ya29.token-cached", expires_in: 3600 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result1 = await refreshVertexToken(sa, null);
    expect(result1.accessToken).toBe("ya29.token-cached");

    // Second call immediately after — should use cache, no network fetch
    const result2 = await refreshVertexToken(sa, null);
    expect(result2.accessToken).toBe("ya29.token-cached");
    expect(global.fetch).toHaveBeenCalledTimes(1); // no second fetch
  });

  it("returns null when OAuth2 endpoint returns error", async () => {
    // Use a fresh SA to avoid cache
    const sa = generateSAJson();

    global.fetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "invalid_grant", error_description: "Invalid JWT" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }),
    );

    // Clear any cache for this email
    const result = await refreshVertexToken(sa, null);
    expect(result).toBeNull();
  });
});

// ─── Region / Location Handling ──────────────────────────────────────────────

describe("VertexExecutor.buildUrl — regions", () => {
  const executor = new VertexExecutor("vertex");
  const model = "gemini-2.0-flash";

  it.each([
    ["us-central1", "us-central1"],
    ["us-east1", "us-east1"],
    ["europe-west1", "europe-west1"],
    ["asia-southeast1", "asia-southeast1"],
  ])("constructs URL with location %s", (location, expectedInUrl) => {
    const sa = generateSAJson();
    const url = executor.buildUrl(model, true, 0, {
      apiKey: JSON.stringify(sa),
      providerSpecificData: { location },
    });
    expect(url).toContain(expectedInUrl);
    expect(url).toContain("projects/my-gcp-project-123");
    expect(url).toContain(`publishers/google/models/${model}:streamGenerateContent`);
    expect(url).toContain("?alt=sse");
    expect(url).not.toContain("key=");
  });

  it("defaults location to us-central1 when providerSpecificData.location is absent", () => {
    const sa = generateSAJson();
    const url = executor.buildUrl(model, true, 0, {
      apiKey: JSON.stringify(sa),
      providerSpecificData: {},
    });
    expect(url).toContain("us-central1");
  });
});

// ─── Endpoint URL Composition ────────────────────────────────────────────────

describe("VertexExecutor.buildUrl — endpoint composition", () => {
  const executor = new VertexExecutor("vertex");
  const model = "gemini-2.0-flash";

  it("builds SA JSON streaming URL: project-scoped path + streamGenerateContent + ?alt=sse", () => {
    const sa = generateSAJson();
    const url = executor.buildUrl(model, true, 0, {
      apiKey: JSON.stringify(sa),
      providerSpecificData: { location: "europe-west1" },
    });
    // Vertex URLs use aiplatform.googleapis.com (no region subdomain)
    expect(url).toBe(
      "https://aiplatform.googleapis.com/v1/projects/my-gcp-project-123/locations/europe-west1/publishers/google/models/gemini-2.0-flash:streamGenerateContent?alt=sse",
    );
  });

  it("builds SA JSON non-streaming URL: no stream suffix, no ?alt=sse", () => {
    const sa = generateSAJson();
    const url = executor.buildUrl(model, false, 0, {
      apiKey: JSON.stringify(sa),
      providerSpecificData: { location: "us-central1" },
    });
    expect(url).toBe(
      "https://aiplatform.googleapis.com/v1/projects/my-gcp-project-123/locations/us-central1/publishers/google/models/gemini-2.0-flash:generateContent",
    );
  });

  it("builds raw API key streaming URL: global endpoint + ?alt=sse&key=", () => {
    const url = executor.buildUrl(model, true, 0, { apiKey: "AIzaSyTestKey123" });
    expect(url).toContain("publishers/google/models/gemini-2.0-flash:streamGenerateContent");
    expect(url).toContain("?alt=sse");
    expect(url).toContain("&key=AIzaSyTestKey123");
    expect(url).not.toContain("projects/");
  });

  it("builds raw API key non-streaming URL: global endpoint + ?key=", () => {
    const url = executor.buildUrl(model, false, 0, { apiKey: "AIzaSyTestKey123" });
    expect(url).toContain("publishers/google/models/gemini-2.0-flash:generateContent");
    expect(url).toContain("?key=AIzaSyTestKey123");
    expect(url).not.toContain("alt=sse");
  });

  it("does not include ?alt=sse for non-streaming requests", () => {
    const url = executor.buildUrl(model, false, 0, { apiKey: "AIzaSyTestKey" });
    expect(url).not.toContain("alt=sse");
  });
});

// ─── Vertex Partner URL ──────────────────────────────────────────────────────

describe("VertexExecutor.buildUrl — vertex-partner", () => {
  const executor = new VertexExecutor("vertex-partner");
  const model = "claude-3-5-sonnet@20240620";

  it("uses global OpenAI-compatible endpoint for partner models", () => {
    const sa = generateSAJson();
    const url = executor.buildUrl(model, true, 0, {
      apiKey: JSON.stringify(sa),
      providerSpecificData: {},
    });
    expect(url).toBe(
      "https://aiplatform.googleapis.com/v1/projects/my-gcp-project-123/locations/global/endpoints/openapi/chat/completions",
    );
  });

  it("throws when project_id is missing for partner models (no SA JSON)", () => {
    expect(() =>
      executor.buildUrl(model, true, 0, {
        apiKey: "AIzaSyRawKey",
        providerSpecificData: {},
      }),
    ).toThrow(/project_id/);
  });

  it("uses raw API key as ?key= query param when no SA JSON", () => {
    const url = executor.buildUrl(model, true, 0, {
      apiKey: "AIzaSyRawKey",
      providerSpecificData: { projectId: "my-project" },
    });
    expect(url).toBe(
      "https://aiplatform.googleapis.com/v1/projects/my-project/locations/global/endpoints/openapi/chat/completions?key=AIzaSyRawKey",
    );
  });

  it("accepts project_id from providerSpecificData when no SA JSON", () => {
    const url = executor.buildUrl(model, true, 0, {
      apiKey: "AIzaSyTest",
      providerSpecificData: { projectId: "from-psd" },
    });
    expect(url).toContain("projects/from-psd");
  });

  it("handles partner model names like claude-3-5-sonnet@20240620", () => {
    const sa = generateSAJson();
    const url = executor.buildUrl("claude-3-5-sonnet@20240620", false, 0, {
      apiKey: JSON.stringify(sa),
      providerSpecificData: {},
    });
    // Partner URL doesn't include model name in the path — it's in the body
    expect(url).toBe(
      "https://aiplatform.googleapis.com/v1/projects/my-gcp-project-123/locations/global/endpoints/openapi/chat/completions",
    );
  });
});

// ─── Stream Guard Verification (AGENTS.md #17) ──────────────────────────────

describe("Vertex stream guard — credentials integration", () => {
  const executor = new VertexExecutor("vertex");
  const model = "gemini-2.0-flash";

  it("signed JWT assertion does not contain stream field", async () => {
    const sa = generateSAJson();

    global.fetch = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: "ya29.mock-stream", expires_in: 3600 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await refreshVertexToken(sa, null);

    const callArgs = global.fetch.mock.calls[0];
    const body = new URLSearchParams(callArgs[1].body);
    const assertion = body.get("assertion");
    const payload = decodeJWTPayload(assertion);

    expect(payload).not.toHaveProperty("stream");
    expect(payload.scope).toBe("https://www.googleapis.com/auth/cloud-platform");

    global.fetch = originalFetch;
  });

  it("VertexExecutor.transformRequest passes stream through — stripping is handler's job", () => {
    // The stream field is stripped by chatCore.js when targetFormat === FORMATS.VERTEX,
    // not by VertexExecutor.transformRequest. transformRequest returns body as-is.
    const sa = generateSAJson();
    const body = {
      model: `vertex/${model}`,
      messages: [{ role: "user", content: "hi" }],
      stream: true,
    };
    const transformed = executor.transformRequest(model, body, true, {
      apiKey: JSON.stringify(sa),
    });
    // transformRequest doesn't strip stream — it's BaseExecutor.transformRequest = identity
    expect(transformed).toHaveProperty("stream", true);
    expect(transformed).toHaveProperty("messages");
  });

  it("VertexExecutor.execute URL uses action suffix not body stream field", async () => {
    // This verifies the URL has :streamGenerateContent (not body.stream)
    const url = executor.buildUrl(model, true, 0, {
      apiKey: "AIzaSyNoSA",
    });
    expect(url).toContain(":streamGenerateContent");
    expect(url).not.toContain(":generateContent?");
  });

  it("Vertex buildUrl adds ?alt=sse for streaming — no body stream needed", () => {
    const url = executor.buildUrl(model, true, 0, {
      apiKey: "AIzaSyTestKey",
    });
    expect(url).toContain("?alt=sse");
  });
});
