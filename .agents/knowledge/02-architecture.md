# Architecture

## Package Layout

```
src/         Next.js app — dashboard, API routes, server libs
open-sse/    Core engine — executors, translators, stream handling (local, not npm)
cloud/       Cloudflare Worker companion
```

`open-sse` resolves via `jsconfig.json` aliases: `"open-sse": ["./open-sse"]`.

## Boot & Routing

1. `bun run dev` / `bun run start` starts Next.js on port 20128
2. `next.config.mjs` rewrites:
   - `/v1/:path*` → `/api/v1/:path*`
   - `/codex/:path*` → `/api/v1/responses`
3. Auth guard: `src/dashboardGuard.js` (JWT cookie + CLI token)
4. SSE handlers delegate to `open-sse` core pipeline

## Request Path (Chat)

```
POST /v1/chat/completions
  → rewrite to /api/v1/chat/completions
  → withApiKeyRateLimit (RPM + concurrent cap)
  → sse/handlers/chat.js
      → resolve model/provider (alias → combo → single)
      → combo expansion (fallback/round-robin)
      → credential loop (getProviderCredentials → checkAndRefreshToken)
  → open-sse/handlers/chatCore.js
      → format detection + 2-step translation (source→OpenAI→target)
      → RTK/compressMessages (tool output trimming)
      → semantic cache read (pre-compute signature BEFORE injectMemory)
      → memory retrieval + injection
      → upstream executor (streaming or non-streaming)
      → response translation back to source format
      → memory extraction (async fire-and-forget)
      → usage tracking + SSE updates
```

## Credential Fallback Loop

```
while (true):
  credentials = getProviderCredentials(provider, excludeConnectionIds, model)
  if (!credentials || all rate-limited) → return 429/503
  refreshed = checkAndRefreshToken(provider, credentials)
  result = handleChatCore(...)
  if (success) → clearAccountError() + return
  markAccountUnavailable(connectionId, status, error, model, resetsAtMs)
  if (shouldFallback) → excludeConnectionId, continue
  else → return error response
```

## SSE Live Streams

| Endpoint | Description |
|---|---|
| `GET /api/console-log` | Console log stream |
| `GET /api/usage/request-logs/stream` | Live request log entries |
| `GET /api/proxy-pools/stream` | Proxy pool events |
| `GET /api/monitoring/health/stream` | Health snapshot every 10s |

**Critical**: Every SSE endpoint using `setInterval`/`setTimeout` MUST attach `request.signal.addEventListener("abort", cleanup)`. Missing this was the primary cause of a 1.2GB memory leak (fixed v0.0.13).

## Cache & Memory Integration

**Semantic cache**:
- Tables: `semantic_cache`, `cache_metrics`
- Layers: LRU (memory) → SQLite (persistence) → In-flight dedup (thundering herd)
- Streaming responses cached after `onStreamComplete`, served as SSE chunks
- Signature pre-computed BEFORE `injectMemory()` — never recompute from `body.messages` at write time
- `memoryOwnerId` in signature prevents cross-key cache bleed
- `MAX_SEMANTIC_CACHE_BYTES = 512KB`
- SQLite TTL comparison: always `strftime('%Y-%m-%dT%H:%M:%SZ', 'now')`

**Conversational memory**:
- Tables: `memories`, `memory_fts` (FTS5)
- Store: LRUCache (500 entries, 4MB, 300s TTL) + SQLite
- 3 retrieval strategies: exact (keyword), semantic (FTS5), hybrid
- 2 languages: EN + Indonesian

## Model Lock System

Three tiers:
1. **Connection-level**: Account-wide errors, exponential cooldown (1h, 2h, 3h...)
2. **Model-level**: Per-model quota/rate errors, minimum lockout configurable
3. **Precise cooldown**: Some providers return `resetsAtMs` — used directly

`modelLockCount_${model}` tracks consecutive failures, cleared on success. Multiplier for minimum lockout (1x, 2x, 3x...).

## Auth Flow

1. **Dashboard**: JWT cookie (`auth_token`, 24h expiry) via login form
2. **API keys**: `Authorization: Bearer` or `x-api-key` header
3. **Per-key rate limiting**: `limitType: unlimited|limited`, RPM + concurrent
4. **Model listing auth**: `GET /v1/models`, `/v1beta/models` enforce when `requireApiKey=true`

## Request Detail Linking

`request_log.details_id` directly references `request_details.id`. Pre-generate ID with `generateDetailId(model)`, pass to both `appendRequestLog` and `saveRequestDetail`. Eliminates fuzzy timestamp matching.

## Docker Runtime

- Multi-stage build: `oven/bun:1.3.14-alpine`
- CMD: `bun /app/server.js` (no `--smol`)
- Memory bounded via cache env vars in Dockerfile
- Data dir: `/app/data` (volume mount), `~/.pod` symlinked inside container

## Cloud Worker

Self-hosted Cloudflare Worker (edge reverse proxy). Stores credentials in D1 (SQLite). Syncs data from Pod via `POST /sync/{machineId}`. Handles LLM requests, OAuth refresh, auto-cleanup (7-day stale records). Relies on `open-sse` for core execution.
