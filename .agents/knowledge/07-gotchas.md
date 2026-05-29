# Gotchas

Read before changing core flow.

## Engine & Build

1. **`open-sse` is local code** — resolves via `jsconfig.json`. Never install from npm.
2. **`/v1/*` is rewrite-driven** — don't create conflicting Next pages under `/v1`.
3. **bun-only workflow** — never npm/pnpm.
4. **Version bump requires two files**: `package.json` + `src/shared/constants/config.js` `displayVersion`.
5. **`node:` protocol imports break webpack** — use bare specifiers (`"os"`, `"path"`) in files bundled by webpack.

## Auth & Security

6. **GET /v1/models and /v1beta/models enforce auth** when `requireApiKey=true`. Don't assume public.
7. **API key model has limit fields** — `limit_type`, `requests_per_minute`, `concurrent_requests`. Not all keys unlimited.
8. **`withApiKeyRateLimit` is in-memory** — single-process only. Comment warns about multi-replica.
9. **No browser `confirm()`** — always use `<ConfirmModal>`. All replaced as of v0.0.4.
10. **No MITM bypass code** — removed v0.0.4. Don't re-add.
11. **Monitoring health auth** — `/api/monitoring/health` uses `extractApiKey()` + `isValidApiKey()`. Bare `/api/health` stays public.
12. **Logger redacts at sink** — `sanitizeForLog()` masks sensitive keys + token-shaped values. Both call-site `maskKey()` AND sink-level sanitizer run. Don't remove either.

## Cache & Memory

13. **Cache signature must be pre-computed** — call `generateSignature()` BEFORE `injectMemory()` mutates `body`. Never recompute at write time — causes 0% hit rate.
14. **Streaming requests ARE cached** — `isCacheableForRead/Write` no longer blocks `stream: true`. Don't re-add the exclusion.
15. **Semantic cache temperature threshold is `> 1`** — not `!== 0`. Most clients send `temperature: 1` by default.
16. **`clearInFlight` unconditional** after ALL three response paths. Don't gate on cache miss or response type.
17. **Cache signature includes `memoryOwnerId`** — different API keys never share entries. Temperature `null` and `1` normalize to same value.
18. **SQLite TTL comparison**: always `strftime('%Y-%m-%dT%H:%M:%SZ', 'now')`. Never `datetime('now')` — space separator + no `Z` breaks string comparison silently.
19. **`generateSignature` handles large payloads** — 64KB tail hash. No size-based bypass guards needed.
20. **`stream=undefined` is cacheable** — treated as non-streaming. Preserve this behavior.
21. **`"recent"` retrieval strategy is explicit alias for `"exact"`** — both resolve to same code path.

## SSE & Streaming

22. **SSE endpoints must attach abort listener** — `request.signal.addEventListener("abort", cleanup)`. Missing this caused 1.2GB memory leak (fixed v0.0.13).
23. **Console Logs lines stored as `{ line, receivedAt }` objects** — always use `wrapLine()`. Don't pass raw strings.
24. **Console Logs scroll to bottom on SSE `init`** — use `requestAnimationFrame` to wait for DOM render before measuring scroll height.
25. **`x-pod-skip-reasoning: true` is perplexity-web only** — drops thinking chunks to improve perceived TTFT. Don't propagate to other providers.

## Database

26. **SQLite pragma sizing** — `mmap_size=64MB`, `cache_size=16MB`. Don't raise without profiling.
27. **`usage_history` auto-trimmed** — `USAGE_HISTORY_MAX_DAYS=90`, trim every 100 inserts.
28. **Request log cap 10K rows** — `LOG_MAX_ROWS=10000` in `usageDb.js`. API cap also 10K.
29. **`better-sqlite3` is devDependency only** — production uses `bun:sqlite`. Don't import in production paths.
30. **`request_log.details_id` links to `request_details`** — pre-generate ID with `generateDetailId(model)`, pass to both calls.
31. **Data dir EACCES/EPERM** — graceful fallback, not crash.

## Providers & Routes

32. **Provider node rename is custom-only** — built-in provider IDs hardcoded in routing. New ID must preserve prefix.
33. **`previousIds[]` enables permanent redirect** — never clear. Stale bookmarks self-heal via `router.replace`.
34. **`/api/memory` routes in PROTECTED_API_PATHS** — dashboard guard applies.
35. **No `/dashboard` prefix** — all routes top-level.
36. **Sidebar taxonomy intentional** — API / Analytics / System. Don't reorder.
37. **Media provider URL segments camelCase** — `/media-providers/webSearch`. Kebab-case variants redirect.
38. **`noAuth` providers must always match as "connected"** — `matchConnected` returns `true` regardless of connection stats.
39. **`/quota` hide-disabled is toggle-controlled** — don't add static filter that always excludes disabled connections.
40. **`log.warn()` doesn't emit** — `console.warn` is commented out. Use `log.error` or `console.warn`.
41. **CI lint is non-blocking** — `bun x eslint . || true`.

## Cloud Worker

42. **`testClaude.js` stub must exist** — `cloud/src/index.js` statically imports it. Missing = deploy failure. Must return 410.
43. **models.dev pricing reads from `model.cost`** — not `model.pricing`. Field mapping: `cost.input`, `cost.output`, `cost.cache_read` → `cached`, `cost.cache_write` → `cache_creation`, `cost.reasoning`.

## Docker

44. **No `--smol` flag** — removed. Memory bounded via cache env vars set in Dockerfile: `SEMANTIC_CACHE_MAX_BYTES=2097152`, `SEMANTIC_CACHE_MAX_SIZE=50`, `PROMPT_CACHE_MAX_BYTES=1048576`, `PROMPT_CACHE_MAX_SIZE=25`.
45. **System info from server-side API** — `process.platform`, `Bun.version` not available client-side. Fetch from `/api/settings`.

## Vercel Relay

46. **5s safety margin** — pod sends `upstreamTimeoutMs - 5000` as `x-relay-timeout` (min 1s). Relay times out first for deterministic error.
47. **Vercel relay 502/504 gets one retry** — `chatCore.js` retries once with 2s delay. Mitigates cold starts.
48. **Vercel relay test uses google.com/generate_204** — not httpbin.org (unreliable).
49. **RELAY_FUNCTION_CODE must be re-deployed** after edits. Editing source in pod doesn't update running relays.

## Vertex AI

50. **Vertex body must never contain `stream`** — controlled via URL action suffix (`streamGenerateContent`) + `?alt=sse`. Both `chatCore.js` (skips injection) and `openaiToVertexRequest` (deletes field) guard this. Both required.

## Kiro

51. **Kiro 500 with `MODEL_TEMPORARILY_UNAVAILABLE` is retryable** — body-gated only. `isTransientErrorBody()` classifier. Exponential backoff 1s/2s/4s with 50–150% jitter, 3 attempts. Don't retry generic 500.

## Tunnel

52. **Tunnel enable `fetchData()` is non-fatal** — wrapped in own try/catch after `pingTunnelHealth()`. Sanitize raw browser error strings.

## Model Lock

53. **`modelLockCount_${model}` tracks consecutive locks** — incremented on lock, cleared on success. Don't reset on non-success paths.
54. **Minimum lockout configurable** — `settings.minimumLockoutMinutes`. Applied as `Math.max(minimumLockoutMs * backoffLevel, cooldownMs)`.

## Combos & Drag

55. **Combos + connections support drag-to-reorder** via `@dnd-kit`. `PATCH /api/combos` with `order` array. `PUT /api/providers/:id` with `priority`.
56. **Custom provider nodes support multiple API keys** — single-connection limit removed v0.0.17.

## UI

57. **`text-primary-fg` required on `bg-primary`** — `--color-primary` flips between near-black (light) and near-white (dark). `text-primary-fg` is the dedicated readable foreground.
58. **Refresh buttons: `size-7` square** — not `<Button size="sm">`. Standardized across app.
