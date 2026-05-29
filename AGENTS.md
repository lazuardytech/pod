# AGENTS.md

Operational rules for AI agents working on **Pod** (`~/projects/lt/pod`).

## Baseline

- Version: **v0.0.76**
- Package: `pod`
- Docker: `lazuardytech/pod` (tags v0.0.1–v0.0.76, latest)
- GitHub: `lazuardytech/pod`, branch `main`
- Data dir: `~/.pod/pod.sqlite`
- Runtime: `bun /app/server.js` (no `--smol`; cache env vars limit heap)
- Tests: **~1300+** across 66 files

## Non-Negotiable Rules

1. **bun only** — install/run/test/build. Never npm or pnpm.
2. **Keep internal naming as `pod`** — package, DB filename, data dir, Docker image.
3. **`open-sse` is local source** — imported via `jsconfig.json` aliases. Do not install from npm.
4. **Use storage facade** — prefer `src/lib/localDb.js` and `src/lib/sqlite/connection.js`.
5. **No browser `confirm()`** — always use `ConfirmModal` from `@/shared/components/Modal`.
6. **No `/dashboard` prefix** — all routes are top-level (`/endpoint`, `/providers`, etc.).
7. **Bump both version fields together** — `package.json` AND `src/shared/constants/config.js` `displayVersion`.
8. **Page-level header actions go through `headerActionStore`** — register buttons via `src/store/headerActionStore.js`, not inline in page components.
9. **API key auth on model listing endpoints** — `GET /v1/models`, `GET /v1/models/[kind]`, `GET /v1beta/models` enforce auth when `requireApiKey=true`. Do not bypass.
10. **SSE endpoints use `open-sse` stream helpers** — `/api/usage/request-logs/stream` and `/api/proxy-pools/stream` follow the same SSE pattern as console logs.
11. **`text-primary-fg` for text on `bg-primary`** — never use `text-white` or `text-black` with `bg-primary`. The `--color-primary` token flips between near-black (light) and near-white (dark); `text-primary-fg` is the paired foreground token that stays readable in both themes.
12. **Provider node rename is custom-only** — `renameProviderNode` and `PATCH /api/provider-nodes/[id]/rename` only work on custom nodes (`openai-compatible-*`, `anthropic-compatible-*`, `custom-embedding-*`). Built-in provider IDs are hardcoded in routing and must never be renamed.
13. **Streaming requests are now cached** — `isCacheableForRead/Write` no longer blocks `stream: true`. Cache hits for streaming clients are served as SSE chunks via `buildCacheHitSSEResponse`. Do not re-add the `stream: true` exclusion. `clearInFlight` is called unconditionally in all three response paths (forced-SSE-to-JSON, non-streaming, streaming) — do not gate it on cache miss or response type.
14. **No `--smol` flag** — removed from `Dockerfile` CMD. Memory is bounded via `SEMANTIC_CACHE_MAX_BYTES`, `SEMANTIC_CACHE_MAX_SIZE`, `PROMPT_CACHE_MAX_BYTES`, `PROMPT_CACHE_MAX_SIZE` env vars instead.
15. **`modelLockCount_${model}` tracks consecutive lock count** — flat field on connection rows, incremented on each lock, cleared on success. Used as backoff multiplier for minimum lockout (1x, 2x, 3x…). Do not reset this field on non-success paths.
16. **models.dev pricing sync runs on boot** — `startPeriodicSync()` is called from `initializeApp.js`. Config key: `modelCostSyncIntervalHours` in settings (default 1h). API: `GET /api/pricing/sync` (status) and `POST /api/pricing/sync` (trigger). Pricing resolution order: user overrides → models.dev → static fallback.
17. **Vertex AI request body must never contain `stream`** — controlled via URL action suffix and `?alt=sse` query param. `chatCore.js` skips stream-field injection when `targetFormat === FORMATS.VERTEX`. `openaiToVertexRequest` also deletes the field. Both guards are required.
18. **Tunnel enable `fetchData()` is non-fatal** — after `pingTunnelHealth()` succeeds, the `fetchData()` call must be wrapped in its own try/catch. Never surface raw browser network error strings (e.g. Safari "Unable to connect...") to the user — sanitize them in the outer catch before displaying.
19. **Cloud worker `testClaude.js` stub must exist** — `cloud/src/index.js` statically imports `./handlers/testClaude.js`. This file must be present and return a 410 deprecated response. Missing it causes the worker to fail to deploy.
20. **Semantic cache signature includes `memoryOwnerId`** — requests from different API keys never share cache entries even if messages are identical. Temperature `null` and `1` produce identical signatures (both normalize to `1`). Do not remove `memoryOwnerId` from `generateSignature` inputs.
21. **SQLite cache TTL uses ISO 8601 format** — `expires_at` is stored as `2026-05-17T...Z`. Always compare with `strftime('%Y-%m-%dT%H:%M:%SZ', 'now')`, never `datetime('now')`. SQLite's `datetime('now')` returns `2026-05-17 ...` (space separator, no `Z`) which fails string comparison against ISO 8601 values silently.
22. **Vercel relay timeout has 5s safety margin** — pod's `upstreamTimeoutMs` minus 5s is sent as `x-relay-timeout` header. Relay always times out before pod, so the error message is deterministic. Minimum 1s for `relayTimeoutMs`. Do not remove this gap.
23. **Vercel relay 502/504 gets one retry** — `chatCore.js` retries once with 2s delay when `proxyOptions.vercelRelayUrl` is set AND response is 502/504. Mitigates cold starts. Do not remove without replacement.
24. **Vercel relay test uses google.com/generate_204** — `proxy-pools/[id]/test` MUST use `https://www.google.com/generate_204` (returns 204 No Content). Do not switch to httpbin.org or other public endpoints — they are unreliable.
25. **Vercel `RELAY_FUNCTION_CODE` must honour `x-relay-timeout`** — the relay function source string in `vercel-deploy/route.js` reads `req.headers.get("x-relay-timeout")`, parses to int, and aborts upstream fetch via its own `AbortController` if exceeded. On timeout returns 504 with `{ error: "Upstream relay request timed out" }`. Pod sends `upstreamTimeoutMs - 5000` so relay times out first. Re-deploy the relay (via `/proxy-pools/vercel-deploy`) after editing this code or it stays out of sync with rules #22–#23.
26. **Kiro 500 with `MODEL_TEMPORARILY_UNAVAILABLE` is body-gated retryable** — AWS CodeWhisperer surfaces overload as HTTP 500 with `{ reason: "MODEL_TEMPORARILY_UNAVAILABLE" }`. `KiroExecutor` retries via separate `transientRetry` budget (`{ attempts: 3, baseDelayMs: 1000, maxDelayMs: 8000 }`) with exponential backoff + 50%–150% jitter. `errorConfig.js` `isTransientErrorBody()` is the single classifier (matches `model_temporarily_unavailable`, `unexpectedly high load`, `overloaded`, `temporarily unavailable`). Do not retry generic 500 — only when body matches.
27. **`/api/monitoring/health` requires API key when `requireApiKey=true`** — mirrors `/v1/models` and `/v1/chat/completions` auth pattern. Use `extractApiKey()` + `isValidApiKey()` from `src/sse/services/auth.js`. The bare `/api/health` heartbeat stays public for liveness probes (Docker `HEALTHCHECK`, Kubernetes, etc.) and returns only `{ ok: true }`. Stream endpoint `/api/monitoring/health/stream` follows the same auth as the snapshot endpoint.
28. **`/api/restart` requires `SHUTDOWN_SECRET` auth** — mirrors `/api/shutdown` auth pattern. Route must never be unprotected. Also in `ALWAYS_PROTECTED` list in `dashboardGuard.js` and proxy middleware matcher.
29. **Global error handlers required** — `process.on('unhandledRejection')` and `process.on('uncaughtException')` in `server-init.js`. Never remove — prevents silent process death.
30. **Kiro TransformStream must have `cancel()` callback** — `transformEventStreamToSSE()` TransformStream must implement `cancel(reason)` that cancels upstream reader. Missing this leaks upstream HTTP connections on client disconnect.
31. **Rate limiting enforced at runtime** — `api_keys.requests_per_minute` and `concurrent_requests` enforced via `withApiKeyRateLimit` and `checkRateLimitByKey`. Model listing endpoints (`/v1/models`, `/[kind]`, `/v1beta/models`) also enforce. Do not bypass.
32. **SSE connection cap at 100** — `_sseConnectionCap.js` shared utility enforces max 100 concurrent SSE streams per route. Returns 503 when exceeded.
33. **Connection lock acquisition uses SQLite transaction** — `updateConnectionRow()` in `localDb.js` wraps read-check-write in `tx()` (`BEGIN IMMEDIATE`). Prevents TOCTOU race where two concurrent requests select the same connection. Never convert back to async read-modify-write.
34. **SIGINT handler must not call `process.exit()` immediately** — `initializeApp.js` SIGINT handler now sets a 5s timeout instead of immediate exit. Lets later-registered handlers (usageDb, requestDetailsDb queue flushes) complete. Queue data loss otherwise.
35. **Qoder executor uses COSY auth** — RSA+AES+MD5 signing via `src/lib/qoder/cosy.js`. Live model catalog from `/algo/api/v2/model/list` via `open-sse/services/qoderModels.js`. SSE response wraps `{statusCodeValue, body}` envelope — must unwrap before forwarding.
36. **`debugLog.js` utility available** — `open-sse/utils/debugLog.js` exports `dbg(tag, msg)` active only when `NODE_ENV != "production"`. Used by codex.js and base.js executors.
37. **`toolDeduper.js` deduplicates MCP tools** — drops built-in tools when equivalent MCP tools present (Exa, Tavily, Browser). Reduces token bloat in Claude requests.
38. **Reasoning passthrough from omniroute** — `stream.js` has `extractReasoningSummaryText()` and `buildReasoningSummaryCompatChunk()`. `streamHelpers.js` `hasValuableContent()` keeps chunks with `reasoning_summary` even when `choices` is empty. Prevents terminal reasoning from being filtered out.
39. **SSE idle timeout — 5 minutes** — all SSE stream routes (`usage/stream`, `proxy-pools/stream`, `health/stream`, `request-logs/stream`) enforce a 5-minute idle timeout via `setTimeout`. On timeout, the stream is closed and cleanup runs. The timeout is cleared on normal client disconnect. Prevents abandoned connection structs from accumulating.
40. **SSRF validation blocks `0.0.0.0` + DNS rebinding** — `src/lib/validateUrl.js` `PRIVATE_IP_PATTERNS` includes `/^0\./` (blocks `0.0.0.0`). `PRIVATE_HOSTNAMES` includes DNS rebinding domains: `nip.io`, `sslip.io`, `localtest.me`, `lvh.me`, `metadata.internal`. Never remove these — user-supplied URLs are validated against this list before server-side fetch.
41. **Vertex token refresh has in-flight dedup** — `refreshVertexToken()` uses `vertexRefreshPromiseCache` Map to dedup concurrent calls for the same service account email. Prevents redundant JWT minting and OAuth calls. Same pattern as all other provider token refreshes.

## Verification Before Push

```bash
bun run check      # biome format + biome lint + eslint (all-in-one)
bun run format     # biome format --write .
bun x eslint .     # lint check
bun run test:run   # vitest
bun run build      # next build
```

## CI / Release

- CI workflow: `.github/workflows/ci.yml` — **Build & Test**
- Docker workflow: `.github/workflows/docker-publish.yml` — **Build & Push Docker Image**
- Docker image: `docker.io/lazuardytech/pod`
- Publish trigger: push tag `v*` (e.g. `v0.0.5`)
- RWX build: `rwx run .rwx/build.yml`

## Docs Map

- Entry: `.agents/INDEX.md`
- Overview: `.agents/knowledge/01-overview.md`
- Architecture: `.agents/knowledge/02-architecture.md`
- Providers & Routing: `.agents/knowledge/03-providers-and-routing.md`
- API Surface: `.agents/knowledge/04-api-surface.md`
- Dev Workflow: `.agents/knowledge/05-dev-workflow.md`
- Conventions: `.agents/knowledge/06-conventions.md`
- Gotchas: `.agents/knowledge/07-gotchas.md`
- Skills System: `.agents/knowledge/08-skills-system.md`
- Fork Status: `.agents/knowledge/09-fork-status.md`
- Open Issues: `.agents/knowledge/10-open-issues.md`
