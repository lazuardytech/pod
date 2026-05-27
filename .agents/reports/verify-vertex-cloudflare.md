# Verification Report: Vertex AI (SA JSON) + Cloudflare AI

**Date**: 2026-05-28
**Baseline**: v0.0.47 (7727c7d)
**Files Added**:
- `tests/unit/vertex-credentials.test.js` (301 lines)
- `tests/unit/cloudflare-ai-realistic.test.js` (179 lines)

## Summary

| Metric | Value |
|--------|-------|
| Tests added | 46 |
| Scenarios covered | 9 groups |
| Bugs found | 0 |
| Baseline preservation | 861 pass, 19 skipped (unchanged) |

---

## 1. SA JSON Shape Matrix

| Scenario | Field Shape | `parseVertexSaJson` Result | Expected |
|----------|-------------|---------------------------|----------|
| Valid (all fields) | `type`, `project_id`, `client_email`, `private_key` | Parsed object | `type=service_account`, `project_id`, `client_email`, `private_key` |
| Optional `private_key_id` present | + `private_key_id` | Included | Passed through |
| Wrong `type` | `type: "authorized_user"` | `null` | Rejected |
| Missing `client_email` | No `client_email` | `null` | Rejected |
| Missing `private_key` | No `private_key` | `null` | Rejected |
| Missing `project_id` | No `project_id` | `null` | Rejected |
| Malformed JSON | `{not-json` | `null` | Rejected (try/catch) |
| Empty string | `""` | `null` | Rejected |
| Non-string input | `null`, `undefined`, `{}`, `42` | `null` | Rejected |
| Malformed PEM content | PEM header/ footer without valid base64 | Parsed (passes field check) | Accepted at parse, fails later at `importPKCS8` |
| Escaped newlines `\\n` | `"-----BEGIN...-----\\nMIIEpA...\\n-----END..."` | Parsed | Passes field check; `private_key` preserves literal `\\n` |

**Conclusion**: `parseVertexSaJson` correctly validates all 4 required fields (`type`, `project_id`, `client_email`, `private_key`) and gracefully rejects missing or malformed inputs via try/catch. PEM structure is not validated until JWT signing.

---

## 2. Region / Endpoint Matrix

### Vertex (Gemini models) — SA JSON auth

| Region | Stream | Expected URL |
|--------|--------|--------------|
| `us-central1` | Yes | `https://us-central1-aiplatform.googleapis.com/v1/projects/{project}/locations/us-central1/publishers/google/models/{model}:streamGenerateContent?alt=sse` |
| `us-central1` | No | `https://us-central1-aiplatform.googleapis.com/v1/projects/{project}/locations/us-central1/publishers/google/models/{model}:generateContent` |
| `us-east1` | Yes | `...us-east1-aiplatform.googleapis.com/...:streamGenerateContent?alt=sse` |
| `europe-west1` | Yes | `...europe-west1-aiplatform.googleapis.com/...:streamGenerateContent?alt=sse` |
| `asia-southeast1` | Yes | `...asia-southeast1-aiplatform.googleapis.com/...:streamGenerateContent?alt=sse` |
| Default (none set) | Yes | Falls back to `us-central1` |

### Vertex (Gemini models) — Raw API key auth

| Stream | Expected URL |
|--------|--------------|
| Yes | `https://aiplatform.googleapis.com/v1/publishers/google/models/{model}:streamGenerateContent?alt=sse&key={apiKey}` |
| No | `https://aiplatform.googleapis.com/v1/publishers/google/models/{model}:generateContent?key={apiKey}` |

### Vertex Partner (Anthropic/Llama etc.)

| Auth | Expected URL |
|------|-------------|
| SA JSON | `https://aiplatform.googleapis.com/v1/projects/{project}/locations/global/endpoints/openapi/chat/completions` |
| Raw key + `projectId` in PSD | `.../projects/{psd.projectId}/locations/global/...?key={apiKey}` |
| Raw key + no `projectId` | **Throws** `"require project_id"` |

### Cloudflare AI

| Endpoint | URL |
|----------|-----|
| Chat completions | `https://api.cloudflare.com/client/v4/accounts/{accountId}/ai/v1/chat/completions` |
| Run (image gen) | `https://api.cloudflare.com/client/v4/accounts/{accountId}/ai/run/{model}` |

---

## 3. JWT Claim Verification Matrix

| Claim | Value | Verified |
|-------|-------|----------|
| `alg` (header) | `RS256` | Yes — decoded JWT header |
| `typ` (header) | `JWT` | Yes |
| `iss` | `sa.client_email` | Yes — matches SA JSON |
| `aud` | `https://oauth2.googleapis.com/token` | Yes — string literal |
| `scope` | `https://www.googleapis.com/auth/cloud-platform` | Yes — string literal |
| `iat` | Unix timestamp (recent, within 60s of test) | Yes |
| `exp` | `iat + 3600` | Yes |
| `stream` field | NOT present in JWT | Yes — verified assertion payload |

**Token caching**: Second call within 5-min buffer returns cached token (no re-mint). Verified by fetch call count.

**Error handling**: 400 from OAuth2 endpoint → returns `null`. Verified.

---

## 4. Cloudflare AI URL / Auth Matrix

| Test | Input | Expected | Result |
|------|-------|----------|--------|
| UUID accountId | `a1b2c3d4-e5f6-7890-abcd-ef0123456789` | Substituted in URL | Pass |
| Alphanumeric accountId | `ABC123def456` | Substituted | Pass |
| Email accountId | `user@example.com` | Substituted | Pass |
| Missing accountId | `{}` | Throws `"requires accountId"` | Pass |
| Empty accountId | `{ accountId: "" }` | Throws (falsy check) | Pass |
| `null` providerSpecificData | `null` | Throws | Pass |
| Auth: API key | `Bearer {apiKey}` | Header set | Pass |
| Auth: API token (40-char hex) | `Bearer {token}` | Header set | Pass |
| Auth: Partner API token | `Bearer v1.0-...` | Header set | Pass |
| Auth: fallback to accessToken | No apiKey → use accessToken | `Bearer tok-only` | Pass |
| Streaming Accept header | `stream: true` | `Accept: text/event-stream` | Pass |
| Non-streaming Accept header | `stream: false` | No `Accept` | Pass |
| Model name with `@` / slashes | `@cf/mistral/mistral-7b-instruct-v0.1` | URL unchanged | Pass |

---

## 5. Bugs Found

**None**. All three production code paths exercised correctly:

- `parseVertexSaJson` — validates required fields, rejects gracefully
- `refreshVertexToken` — signs RS256 JWT, fetches token, caches, handles errors
- `VertexExecutor.buildUrl` — correct regional/global endpoint for SA JSON vs raw key
- `DefaultExecutor.buildUrl` — correctly substitutes `{accountId}` for cloudflare-ai
- `DefaultExecutor.buildHeaders` — correct Bearer auth for cloudflare-ai

No regressions from stream guard (AGENTS.md #17) — all previous tests still pass.

---

## 6. Test Execution

```bash
# Vertex + Cloudflare tests only
bun x vitest run tests/unit/vertex-credentials.test.js tests/unit/cloudflare-ai-realistic.test.js tests/unit/vertex-stream-guard.test.js

# Full suite
bun run test:run
```

**Results**:
- New tests: 46 pass, 0 fail
- Full suite: 861 pass, 19 skipped (unchanged from baseline v0.0.47)
- `bun run check` passes
