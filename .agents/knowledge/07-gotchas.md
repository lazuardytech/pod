# Gotchas

Read this before changing core flow.

## 1) `open-sse` is local code, not dependency

`open-sse/*` imports resolve via `jsconfig.json`. Do not install or replace with npm package versions.

## 2) `/v1/*` is rewrite-driven

`next.config.mjs` rewrites `/v1/*` to `/api/v1/*`. Do not create conflicting Next pages under `/v1`.

## 3) bun-only workflow

Use bun for install/build/test/CI parity. Do not use npm or pnpm commands in this repo.

## 4) Public API limiter is route-wrapped

`withApiKeyRateLimit` is applied on `/api/v1/*` routes. If you add a new public POST endpoint, wire the wrapper unless explicitly exempt.

## 5) API key model has limit fields

`api_keys` includes `limit_type`, `requests_per_minute`, `concurrent_requests`, `last_access_at`.
Do not assume all keys are unlimited.

## 6) Cache and memory are first-class features

- Cache: `/api/cache`, `/api/settings/cache-config`
- Memory: `/api/memory`, `/api/memory/[id]`, `/api/settings/memory`

If you touch chat pipeline, validate cache/memory behavior.

## 7) Sidebar taxonomy is intentional

Keep the grouped menu layout:
- API
- Analytics
- System

Route pages can exist without sidebar exposure (e.g. translator/basic-chat).

## 8) SQLite is the source of truth

Default file: `~/.pod/pod.sqlite`.
Use `localDb` / sqlite helpers instead of ad-hoc JSON state changes.

## 9) `log.warn()` caveat

`src/sse/utils/logger.js` currently does not emit `warn` logs. Prefer `log.error` or `console.warn`.

## 10) CI lint step is non-blocking

`ci.yml` runs `bun x eslint . || true`. Do not assume lint failure blocks CI.

## 11) Docker publishing target

Release images publish to Docker Hub `lazuardytech/pod` via tag `v*`.
Do not document GHCR for this repo.

## 12) No `/dashboard` prefix on routes

All dashboard routes are top-level (e.g. `/endpoint`, `/providers`, `/logs`, `/health`).
Do not add or assume a `/dashboard` prefix when linking or redirecting.

## 13) `/logs` is the consolidated log page

Multi-tab: Request Logs, Proxy Logs, Console Logs.
Do not create standalone `/console-log` or `/proxy-logs` pages.

## 14) No browser `confirm()`

Always use `<ConfirmModal>` from `@/shared/components/Modal`.
All existing `confirm()` calls have been replaced as of v0.0.4.

## 15) No MITM bypass code

MITM DNS bypass was removed in v0.0.4. Do not re-add `MITM_BYPASS_HOSTS`, `resolveRealIP`, `createBypassRequest`, or `getMitmAlias`/`setMitmAliasAll`.

## 16) `request_log.details_id` links to `request_details`

As of v0.0.5, `request_log` has a `details_id` column.
When saving a completed request, pre-generate the ID with `generateDetailId(model)` and pass it to both `appendRequestLog` and `saveRequestDetail`.
The `/api/usage/request-logs/[id]` route does direct lookup by `details_id` first.

## 17) `better-sqlite3` is devDependency only

Production uses `bun:sqlite`. `better-sqlite3` is only for tests (Node/vitest).
Do not import `better-sqlite3` in production code paths.

## 18) Version bump requires two files

Always bump both:
- `package.json` → `"version"`
- `src/shared/constants/config.js` → `displayVersion`

## 19) System info must come from server-side API

`process.platform`, `process.arch`, `Bun.version` are not available in client components.
Fetch from `/api/settings` which includes `systemInfo: { runtime, platform }`.

## 20) SegmentedControl for all tab UIs

Use `<SegmentedControl>` from `@/shared/components/SegmentedControl` for all pill tab navigation.
Always use `size="sm"`. Do not create custom inline tab div/button patterns.

## 21) GET /v1/models and /v1beta/models require auth when requireApiKey=true

As of v0.0.6, model listing endpoints enforce API key auth when `settings.requireApiKey` is enabled.
Do not assume these endpoints are always public. Use timing-safe comparison via `validateApiKey`.

## 22) Semantic cache: stream=undefined is treated as non-streaming

`isCacheableForRead` and `isCacheableForWrite` treat `stream=undefined` as non-streaming (cacheable).
Previously this was always a cache miss. If you touch the cache eligibility logic, preserve this behavior.

## 23) headerActionStore for page-level header buttons

Page-level action buttons (e.g. "Connected Only" toggle on /providers) are registered via
`src/store/headerActionStore.js`. Do not render them inline in the Header component.
Register in a `useEffect` and clean up on unmount.

## 24) Media provider URL segments are camelCase

`/media-providers/webSearch` and `/media-providers/webFetch` use camelCase.
Kebab-case variants (`web-search`, `web-fetch`) redirect to camelCase.
Do not create new kebab-case sub-routes under `/media-providers`.

## 25) Blackbox and MiniMax are supported providers

Blackbox (LLM) and MiniMax (TTS) are supported as of v0.0.6.
Do not treat them as unknown providers when encountered in provider config or routing code.

## 26) `text-primary-fg` required when text sits on `bg-primary`

`--color-primary` flips: near-black (`#111111`) in light theme, near-white (`#e5e5e6`) in dark theme.
Using `text-white` with `bg-primary` produces unreadable white-on-white in dark mode.
Always pair `bg-primary` with `text-primary-fg` (the dedicated foreground token).
This applies to buttons, badges, chips, and any element using `bg-primary` as background.

## 27) Semantic cache now covers streaming requests

`isCacheableForRead` and `isCacheableForWrite` no longer exclude `stream: true` requests.
Streaming responses are written to cache inside `onStreamComplete` in `open-sse/handlers/chatCore.js`.
Cache hits for streaming clients are served as SSE chunks via `buildCacheHitSSEResponse`.
Do not re-add a `stream: true` guard to the cache eligibility functions — it was the root cause of 0% hit rate.

## 28) Provider node rename: custom nodes only, prefix must be preserved

`renameProviderNode(oldId, newId)` and `PATCH /api/provider-nodes/[id]/rename` only accept custom nodes.
Built-in provider IDs (`openai`, `anthropic`, `gemini`, `codex`, etc.) are hardcoded in routing handlers and must never be renamed.
The new id must start with the same type prefix (`openai-compatible-`, `anthropic-compatible-`, `custom-embedding-`).
The function is a single SQLite transaction — partial renames cannot occur.

## 29) `previousIds[]` enables permanent URL bookmark redirect for renamed providers

Every rename appends the old id to `node.data.previousIds[]`.
`ProviderDetailClient` checks this array when a node lookup by URL id returns nothing, then calls `router.replace` to the current id.
Do not clear `previousIds` — it is the redirect map for all historical bookmarks.

## 30) Request log cap is 10 000 rows

`LOG_MAX_ROWS = 10000` in `src/lib/usageDb.js`. The `/api/usage/request-logs` endpoint cap is also 10 000.
Do not lower these values without updating both locations together.

## 31) Console Logs lines are stored as `{ line, receivedAt }` objects

`ConsoleLogClient` wraps every incoming log string as `{ line: string, receivedAt: string }` via `wrapLine()`.
`LogLine` uses `parseTimestamp(line) || receivedAt` for display — lines without a `[HH:MM:SS]` prefix show the receive time instead of `—`.
Do not pass raw strings into the logs state array; always use `wrapLine()`.

## 32) SSE endpoints must attach an abort listener

Every SSE endpoint that uses `setInterval` or `setTimeout` must attach:
```js
request.signal.addEventListener("abort", cleanup)
```
Omitting this orphans timers on client disconnect and causes unbounded memory growth.
`proxy-pools/stream` and `request-logs/stream` were the source of a 1.2GB leak fixed in v0.0.13.

## 33) SQLite pragma sizing

`connection.js` sets `mmap_size = 64MB` and `cache_size = 16MB`.
Do not raise these without profiling — the previous values (256MB / 64MB) contributed to the v0.0.13 memory leak.

## 34) `usage_history` is trimmed automatically

`USAGE_HISTORY_MAX_DAYS = 90` in `src/lib/usageDb.js`. Trim runs every 100 inserts.
`getUsageHistory()` default LIMIT is 10 000. Do not remove the trim or raise the retention window without considering DB growth.

## 35) `bun --smol` has been removed from Docker

`Dockerfile` CMD is now `bun /app/server.js` (no `--smol`).
Memory is bounded instead via env vars set in the Dockerfile:
- `SEMANTIC_CACHE_MAX_BYTES=2097152` (2MB)
- `SEMANTIC_CACHE_MAX_SIZE=50`
- `PROMPT_CACHE_MAX_BYTES=1048576` (1MB)
- `PROMPT_CACHE_MAX_SIZE=25`

Do not re-add `--smol` — it throttles the heap globally and hurts throughput under load.

## 36) Semantic cache temperature threshold is `> 1`, not `!== 0`

`isCacheableForRead` and `isCacheableForWrite` skip caching when `temperature > 1`.
The previous guard (`temperature !== 0`) caused near-zero cache hit rates because most clients send `temperature: 1` by default.
Do not revert to `!== 0`.

## 38) Semantic cache write must use pre-injection signature

`generateSignature()` is called **before** `injectMemory()` mutates `body.messages`.
All write paths in `chatCore.js` must reuse `cacheSignature` (computed at read time),
not recompute from `body.messages` — which by write time contains injected memory.
Recomputing causes read/write signature mismatch → 0% hit rate.

## 39) Custom provider nodes support multiple API keys

As of v0.0.17, the single-connection limit for `openai-compatible-*`, `anthropic-compatible-*`,
and `custom-embedding-*` nodes has been removed. Multiple connections (API keys) per node
are now allowed, same as built-in providers like Kiro and Codex.

## 40) Combos and provider connections support drag-to-reorder

`/combos` list and `/providers/[id]` connection list both support drag-to-reorder via `@dnd-kit`.
- Combos: `PATCH /api/combos` with `{ order: string[] }` saves sort order to `sort_order` column.
- Connections: `PUT /api/providers/:id` with `{ priority: number }` per connection.

## 41) Minimum lockout time is configurable

`settings.minimumLockoutMinutes` (default `0` = disabled) sets a floor for model lockout duration.
When set, `markAccountUnavailable` applies `Math.max(minimumLockoutMs * backoffLevel, cooldownMs)`.
Backoff multiplier: 1x on first failure, 2x on second, 3x on third, etc.
Configured via Settings → Routing Strategy → Minimum Lockout Time.

## 42) Refresh buttons use size-7 square style

All Refresh buttons across the app use the `/logs` standard:
```jsx
<button className="flex items-center justify-center size-7 rounded-[4px] border border-charcoal-grey
  text-storm-cloud hover:bg-deep-slate hover:text-porcelain transition-colors duration-100
  disabled:opacity-50 disabled:cursor-not-allowed">
  <span className={`material-symbols-outlined text-[15px] ${refreshing ? 'animate-spin' : ''}`}>refresh</span>
</button>
```
Do not use `<Button size="sm" icon="refresh" />` for standalone refresh actions.

## 43) `node:` protocol imports break webpack bundling

Next.js webpack cannot resolve `node:os`, `node:path`, etc. in files that are imported
by client-side or shared code. Use bare specifiers (`"os"`, `"path"`) in `open-sse/config/*`
and any file that may be bundled by webpack. `node:` protocol is fine in pure server-side
API routes and Node.js-only modules.

`renameProviderNode` appends the old id to `node.data.previousIds[]` on every rename.
`ProviderDetailClient` uses this array to redirect stale bookmark URLs to the current id via `router.replace`.
Clearing `previousIds` breaks all historical bookmarks permanently.

## 44) Vertex AI request body must never contain `stream`

Vertex AI controls streaming via URL action suffix (`streamGenerateContent`) and `?alt=sse` query param — not a body field.
`chatCore.js` skips the stream-field injection step when `targetFormat === FORMATS.VERTEX`.
`openaiToVertexRequest` also explicitly deletes `stream` from the translated body.
Both guards are required. Injecting `stream: true` into a Vertex request body causes API errors.

## 45) models.dev sync reads pricing from `model.cost`, not `model.pricing`

The models.dev API response nests pricing under `model.cost`, not `model.pricing` or top-level fields.
Field mapping:
- `cost.input` → input price per token
- `cost.output` → output price per token
- `cost.cache_read` → `cached`
- `cost.cache_write` → `cache_creation`
- `cost.reasoning` → reasoning price per token

Do not read from `model.pricing` or top-level `input`/`output` fields — they do not exist in the response.

## 46) Semantic cache: `generateSignature` handles large payloads — no size bypass needed

`generateSignature` already handles large payloads via a 64KB tail hash. The `requestTooLargeForCache` guard has been removed from `chatCore.js`.
Do not add size-based bypass guards before the cache check — they cause false cache misses for large-but-valid requests.

## 47) noAuth providers must always match as "connected"

## 48) Tunnel enable: `fetchData()` after `pingTunnelHealth()` must be non-fatal

After `pingTunnelHealth()` succeeds, `fetchData()` is called to refresh UI state. This call can throw browser network errors (e.g. Safari "Unable to connect to the server"). Wrap it in its own try/catch so the error does not propagate to the outer catch and surface as a confusing user-visible message. Sanitize raw browser error strings before displaying them.

## 49) Cloud worker: `cloud/src/handlers/testClaude.js` must exist

`cloud/src/index.js` statically imports `./handlers/testClaude.js`. If this file is missing, the worker fails to deploy entirely. The stub must return a 410 deprecated response. Do not delete or omit it.

## 50) Console Logs: scroll to bottom on SSE `init` message

When the SSE connection sends the `init` event (initial log dump), scroll the log container to the bottom using `requestAnimationFrame` to ensure the DOM has rendered the new entries before measuring scroll height. Scrolling synchronously before the render cycle completes will land at the wrong position.

## 51) `/quota` hide-disabled is toggle-controlled, not permanent

Disabled connections on `/quota` are only hidden when the "Hide disabled" toggle is active. There is no permanent `isActive !== false` filter. Do not add a static filter that always excludes disabled connections — it was removed intentionally so users can see disabled quota entries when the toggle is off.

Providers like Kiro and OpenCode Free have no connections (no API key required).
`matchConnected` must return `true` for these providers regardless of connection stats.
Filtering them out under "Connected Only" is incorrect — they are always available.
Check for `noAuth` flag before applying connection-based filtering logic.

## 52) Semantic cache SQLite TTL — always use `strftime`, never `datetime('now')`

`expires_at` in `semantic_cache` is stored as ISO 8601 (`2026-05-17T12:00:00Z`).
SQLite's `datetime('now')` returns `2026-05-17 12:00:00` (space separator, no `Z`), which fails
string comparison against ISO 8601 values silently — every row appears unexpired.
Always compare with:
```sql
strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
```
This was the primary root cause of 0 cache hits from SQLite in v0.0.30.

## 53) Cache signature includes `memoryOwnerId` — different API keys never share entries

`generateSignature` takes `memoryOwnerId` (derived from the API key) as an input.
Two requests with identical messages but different API keys produce different signatures.
This prevents cross-user cache bleed and ensures memory injection cannot be bypassed via cache hits.
Temperature `null` and `1` are normalized to the same value — omitting the field and sending `1` explicitly produce the same signature.

## 54) `clearInFlight` must be called unconditionally after every response path

`clearInFlight` must be called after all three response paths in `chatCore.js`:
- forced-SSE-to-JSON conversion
- non-streaming response
- streaming response

If any path skips `clearInFlight`, concurrent identical requests will stall for 60 seconds waiting
for the in-flight entry to expire. Do not gate this call on cache miss or response type.

## 55) Kiro 500 with `MODEL_TEMPORARILY_UNAVAILABLE` is transient — body-gated retry only

AWS CodeWhisperer (Kiro backend) returns HTTP **500** with a JSON body when the model is overloaded:
```json
{
  "message": "Encountered unexpectedly high load when processing the request, please try again.",
  "reason": "MODEL_TEMPORARILY_UNAVAILABLE"
}
```
Generic 500 retry would mask real bugs (e.g. malformed payload, deserialization), so we **only**
retry HTTP 500/503 when the body matches `isTransientErrorBody()` patterns (defined in
`open-sse/config/errorConfig.js`):
- `MODEL_TEMPORARILY_UNAVAILABLE` (Kiro)
- `unexpectedly high load`
- `temporarily unavailable`
- `overloaded` (Anthropic-style)
- `server is busy` (some Bedrock variants)
- `model is overloaded` (Google AI Studio)

Kiro executor (`open-sse/executors/kiro.js`) implements this in `execute()`. Defaults from
`config/providers.js`: `transientRetry: { attempts: 3, baseDelayMs: 1000, maxDelayMs: 8000 }`.
Delay uses exponential backoff with **0.5x–1.5x jitter** to avoid synchronized retries hammering
an already-degraded upstream.

Three layers of self-healing:
1. **In-request retry** (kiro executor) — body-aware, fast (sub-10s)
2. **Account-level backoff** (`ERROR_RULES` in `errorConfig.js`) — escalates `backoffLevel`
   on consecutive failures, lock duration grows exponentially
3. **Account fallback** (`markAccountUnavailable` in `sse/services/auth.js`) — switches to next
   connection automatically

When reading the response body to peek for transient patterns, **always use `response.clone()`**
so the original body remains consumable by `parseUpstreamError` if the retry budget is exhausted.

## 56) Vercel relay must be re-deployed after RELAY_FUNCTION_CODE changes

The relay function source string in `src/app/api/proxy-pools/vercel-deploy/route.js` is
deployed to Vercel as the project's `api/relay.js` file. Editing that string in pod source
does NOT update relays already running in users' Vercel projects.

If you change `RELAY_FUNCTION_CODE` (e.g. to honour a new header, change runtime, fix a bug),
existing pools must be redeployed via the same `POST /api/proxy-pools/vercel-deploy` endpoint
with the user's Vercel token. There is currently no auto-update mechanism — document the
requirement in release notes whenever the string changes.

Pod sends `x-relay-timeout: max(1000, upstreamTimeoutMs - 5000)` to the relay so the relay
times out first and emits a controlled 504. If the deployed relay code ignores
`x-relay-timeout`, that race is no longer deterministic — pod's outer AbortController kicks in
instead and error messages flip between "Request aborted" and "Upstream relay request timed out".

Verified by AGENTS.md rules #22 (5s margin), #23 (one retry on 502/504), #25 (relay function
must honour header).

## 57) `src/sse/utils/logger.js` redacts at the sink — do not weaken

CodeQL alert #39 (`js/clear-text-logging`) flagged the logger because static taint analysis
traced `apiKey` reaching `console.log`. Existing call-site masking via `maskKey()` was correct
in practice but invisible to the analyzer. v0.0.49 added `sanitizeForLog()` that runs at every
log call:

- Sensitive object keys (`apiKey`, `access_token`, `refresh_token`, `id_token`, `cookie`,
  `authorization`, `password`, `secret`, `client_secret`, `private_key`, `sa_json`,
  `service_account`) get prefix...suffix masking; non-string values become `[redacted]`.
- Token-shaped values inside strings (`Bearer …`, `sk-…`, JWT `eyJ…`) are masked inline.
- Recursion depth-capped at 4 to prevent infinite loops on cyclic refs.

This complements (does not replace) call-site `maskKey()`. **Both layers run** — defense in
depth. If you remove the sink-level sanitizer, the CodeQL alert returns and a future contributor
forgetting to mask leaks credentials in production logs.

## 58) `x-pod-skip-reasoning: true` is opt-in for `perplexity-web` only

Perplexity's web product (`/rest/sse/perplexity_ask`) takes 5–15s per query because the upstream
runs search → read sources → plan → reason → generate. Pod streams chunks as they arrive
(`X-Accel-Buffering: no`), but the first 3–4s only emits `reasoning_content` chunks
(Searching:/Reading:/Plan:). Clients that don't render reasoning see that as idle time.

`v0.0.54` adds opt-in header `x-pod-skip-reasoning: true` (back-compat alias
`x-omniroute-skip-reasoning: true`). When set, perplexity-web's executor drops thinking chunks
and streams only the markdown answer. Total upstream latency unchanged — only perceived TTFT.

The header is checked case-insensitively and works for both `Headers` instances and plain
objects. The plumbing path is `chatCore.js → executor.execute({ clientHeaders }) →
buildStreamingResponse({ skipReasoning })`. Do not propagate the flag to other providers — it
is currently perplexity-web-specific because that is the only executor that emits
`reasoning_content` for non-reasoning models.
