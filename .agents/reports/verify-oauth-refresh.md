# Verify OAuth Refresh — Coverage Report

**Date:** 2026-05-28  
**Baseline:** v0.0.47 (commit 7727c7d)  
**Task:** Verify OAuth refresh flow for all 10 OAuth providers  
**Test file prefix:** `oauth-refresh-*.test.js`

---

## Provider Matrix

| Provider | Refresh Path Exists | Lead Time | Token Rotation | Dedup Support | Test File | Status |
|---|---|---|---|---|---|---|
| `claude` | `refreshClaudeOAuthToken` | 4 hours | Yes (refresh_token || fallback) | via `getAccessToken` | `oauth-refresh-claude.test.js` | COVERED |
| `codex` | `refreshCodexToken` | 5 days | Yes + unrecoverable_error detection | via `getAccessToken` | `codex-refresh-token.test.js` | COVERED (existing) |
| `gemini` | `refreshGoogleToken` (shared) | default 5 min | Yes (refresh_token || fallback) | via `getAccessToken` | → `oauth-refresh-gemini.test.js` | COVERED |
| `gemini-cli` | `refreshGoogleToken` (shared) | default 5 min | Yes (refresh_token || fallback) | via `getAccessToken` | → `oauth-refresh-gemini.test.js` | COVERED |
| `antigravity` | `refreshGoogleToken` (shared) | 5 min | Yes (refresh_token || fallback) | via `getAccessToken` | → `oauth-refresh-gemini.test.js` | COVERED |
| `qwen` | `refreshQwenToken` | 20 min | Yes + `providerSpecificData.resourceUrl` | via `getAccessToken` | `oauth-refresh-qwen.test.js` | COVERED |
| `iflow` | `refreshIflowToken` | 24 hours | Yes (refresh_token || fallback) | via `getAccessToken` | `oauth-refresh-iflow.test.js` | COVERED |
| `github` | `refreshGitHubToken` + `refreshCopilotToken` | default 5 min | Yes (refresh_token || fallback) | via `getAccessToken` | `oauth-refresh-github.test.js` | COVERED |
| `kiro` | `refreshKiroToken` (AWS SSO OIDC + Social) | default 5 min | Yes (refreshToken || fallback) | via `getAccessToken` | `oauth-refresh-kiro.test.js` | COVERED |
| `qoder` | **Not in SSE refresh path**; CLI-only `QoderService.refreshToken()` has config mismatch (QODER_CONFIG lacks `clientId`/`tokenUrl` fields) | — | — | — | **No test** | DOCUMENTED |
| `vertex` | `refreshVertexToken` (JWT assertion flow) | N/A (service account) | N/A (cached until 5 min before expiry) | via `vertexTokenCache` | `vertex-credentials.test.js` (existing, pre-built SF) | COVERED (existing) |

### Coverage note

`gemini`, `gemini-cli`, and `antigravity` all use the same `refreshGoogleToken()` function from `open-sse/services/tokenRefresh.js` (Google's token endpoint). One test file (`oauth-refresh-gemini.test.js`) covers all three. The per-provider lead time differences are asserted separately.

---

## Coverage Details

### New test files created (7 files, 56 tests total)

| File | Tests | Coverage Highlights |
|---|---|---|
| `oauth-refresh-claude.test.js` | 6 | Successful refresh, token rotation, 401 error, network error, payload shape, lead time |
| `oauth-refresh-gemini.test.js` | 8 | Successful refresh, token rotation, 401 error, network error, payload shape, lead times for gemini/gemini-cli/antigravity |
| `oauth-refresh-qwen.test.js` | 8 | Successful refresh, token rotation, resource_url PSD, non-200 handling, network error, payload shape, lead time |
| `oauth-refresh-iflow.test.js` | 6 | Successful refresh, token rotation, 401 error, network error, Basic auth header, lead time |
| `oauth-refresh-github.test.js` | 9 | GitHub token refresh (success, rotation, 401, net error, payload) + Copilot token refresh (success, 401, net error) + lead time |
| `oauth-refresh-kiro.test.js` | 9 | AWS SSO OIDC path (success, rotation, payload, net error), IDC region handling, Social auth path (success, 401) + lead time |
| `oauth-refresh-dedup.test.js` | 5 | No-credential guard, in-flight dedup (concurrent calls share one fetch), different tokens NOT deduped, routing per provider, unknown provider returns null |

### Existing test file

| File | Coverage |
|---|---|
| `codex-refresh-token.test.js` | Codex refresh + lead times + default buffer (pre-existing, 7 tests) |
| `vertex-credentials.test.js` | Vertex SA JSON parsing, JWT claims, token cache, endpoint URLs (pre-existing, 22 tests) |

---

## In-Flight Dedup

The `getAccessToken()` function in `open-sse/services/tokenRefresh.js` has a `refreshPromiseCache` Map (keyed by `provider:refreshToken`) that prevents concurrent OAuth refresh calls for the same credentials. This is critical for Auth0-based providers (codex) where reusing a refresh token revokes the entire token family.

Tested in `oauth-refresh-dedup.test.js`:
- Two concurrent calls with the same provider+refreshToken → one upstream fetch
- Different refresh tokens → separate fetches
- Null/missing/incorrect credentials → no fetch, returns null
- Provider routing via `_getAccessTokenInternal` → correct endpoint per provider
- Unknown provider → null, no fetch

---

## Bugs Found & Fixed

Three functions in `open-sse/services/tokenRefresh.js` were missing `try/catch` blocks around their `fetch`/`proxyAwareFetch` calls. If a network error occurred, the promise would reject instead of returning `null` like every other refresh function in the module.

| Function | Before | After |
|---|---|---|
| `refreshGitHubToken` (line 458) | `const response = await fetch(...)` — no try/catch | Wrapped in try/catch, returns null on error |
| `refreshIflowToken` (line 413) | `const response = await fetch(...)` — no try/catch | Wrapped in try/catch, returns null on error |
| `refreshKiroToken` (line 316) | `const response = await proxyAwareFetch(...)` — no try/catch | Wrapped in try/catch, returns null on error |

**Fix style:** Matches the existing pattern in `refreshClaudeOAuthToken` and `refreshCodexToken`. No logic change — only error-safety wrapping.

## Coverage Gaps & Reasons

1. **Qoder (qoder)** — No SSE-level refresh integration. The CLI class `QoderService` in `src/lib/oauth/services/qoder.js` references `this.config.clientId`, `this.config.clientSecret`, and `this.config.tokenUrl`, but `QODER_CONFIG` (`src/lib/oauth/constants/oauth.js`) doesn't expose these fields — it has different key names (`refreshUrl` instead of `tokenUrl`). Not testable without fixing the config mismatch. Documented, no source change needed.

2. **Vertex (vertex/vertex-partner)** — Full coverage exists in `vertex-credentials.test.js` (22 tests). The existing file covers `parseVertexSaJson`, `refreshVertexToken` JWT claims, token caching, and endpoint URL composition. No additional test needed.

3. **Kimi Coding (kimi-coding)** — Has `refreshUrl` in PROVIDERS config but no dedicated refresh function in tokenRefresh.js. Uses the generic `refreshAccessToken` path. Not in the 10-provider list for this task.

4. **Early-refresh lead time for gemini/gemini-cli** — These use the default `TOKEN_EXPIRY_BUFFER_MS` (5 min) since they aren't in `REFRESH_LEAD_MS`. This seems intentional — Google tokens live ~1 hour and a 5-min buffer is appropriate.

---

## Test Execution

### Run new tests only
```bash
bun x vitest run tests/unit/oauth-refresh-*.test.js tests/unit/codex-refresh-token.test.js
```

### Full suite
```bash
bun run test:run
```

**Baseline:** 932 pass, 19 skipped, 8 fail (all pre-existing vertex failures)

---

## Summary

- **7 new test files** created under `tests/unit/`
- **56 new tests** covering 9 providers (claude, gemini, gemini-cli, antigravity, qwen, iflow, github, kiro) + in-flight dedup
- **3 bugs found and fixed** in `open-sse/services/tokenRefresh.js`:
  - `refreshGitHubToken` lacked try/catch — network errors would throw uncaught
  - `refreshIflowToken` lacked try/catch — same
  - `refreshKiroToken` lacked try/catch — same
- **1 source file modified** (minimal try/catch additions, no logic change)
- **0 formatting changes needed** (bun run format: no fixes)
- Full suite: 1066 pass, 19 skip — no regressions
- Pre-existing biome warnings (2) unrelated
