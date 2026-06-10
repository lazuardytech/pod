# Architecture

## Main Modules

- `src/`: Next.js app (dashboard UI + API routes + SSE handlers)
- `open-sse/`: Local routing engine — translators, executors, RTK, stream utils
- `cloud/`: Cloudflare Worker for cloud proxy (D1 + KV)
- `docker/`: Multi-service deployment (pod + redis + searxng)

## Request Flow

1. Client calls compatibility endpoint (`/v1/*`, `/v1beta/*`, `/api/*`)
2. Next route applies auth + rate-limit checks (via `dashboardGuard.js` + `src/lib/rateLimit/`)
3. Request enters `src/sse/handlers/` (server-side auth, credential resolution)
4. Delegates to `open-sse/handlers/` (core pipeline: routing, translation, execution)
5. Model/provider resolution + fallback strategy via `services/accountFallback.js`
6. Semantic cache read + memory injection
7. Format translation: source → OpenAI → target (via `translator/` pipeline)
8. Provider executor call via `executors/` (specialized or default)
9. Response translation back to client format
10. Stream/JSON dispatch via `utils/stream.js` (passthrough or translate mode)
11. Usage and request details persisted to SQLite

## Data Layer

- SQLite via `bun:sqlite` (`src/lib/sqlite/connection.js`)
- `src/lib/localDb.js` — central data access facade (35+ consumers)
- Schema: provider_connections, api_keys, model_aliases, settings, memories (FTS5), semantic_cache, usage_history, request_details, etc.
- JSON→SQLite migration on first boot (`src/lib/sqlite/migrate-from-json.js`)

## Auth Middleware Layer

- `src/dashboardGuard.js` + `src/proxy.js`: JWT + CLI token matcher
- `PROTECTED_API_PATHS`: `/api/settings`, `/api/keys`, `/api/provider-nodes`, `/api/memory`, `/api/cache`, `/api/models`, `/api/translator`, `/api/tunnel`
- `ALWAYS_PROTECTED`: `/api/shutdown`, `/api/restart`, `/api/settings/database`, `/api/settings/migrate-sqlite`
- Any new mutation route must be added to both lists and `proxy.js` matcher

## Rate Limiting Layer

- `src/lib/rateLimit/backend.js`: Auto-selects Redis or in-memory based on `REDIS_URL`
- `src/lib/rateLimit/redis.js`: Sliding window RPM via Sorted Set, concurrent via INCR/DECR
- `src/lib/rateLimit/memory.js`: In-process fallback with TTL-based cleanup
- `src/lib/rateLimit/index.js`: `withApiKeyRateLimit(request, handler)`, `checkRateLimitByKey(key)`
- Duck-type dispatch: `backend.releaseRpm?.(...)` — never `constructor.name` or `instanceof`
- 15+ v1 API routes wrapped with `withApiKeyRateLimit`

## Error Handling and Input Safety

- `src/lib/parseJsonBody.js`: Safe JSON parsing (try/catch). Used in 45+ mutation routes.
- `src/lib/sanitizeError.js`: `"Internal server error"` in prod, `error.message` in dev. Used in 60+ API routes.
- Upstream API error bodies never forwarded to client — generic status-only messages.

## SSE Crash Hardening

- `src/sse/handlers/chat.js`: `while(true)` fallback loop with `MAX_FALLBACK_ITERATIONS=50`, wrapped in `try/catch`
- `open-sse/utils/stream.js`: `transform()` and `flush()` wrapped in `try/catch` with graceful SSE error terminator
- `open-sse/handlers/chatCore.js`: Peek `getReader()` and `reader.read()` wrapped in `try/catch`

## Credential Management

- `src/sse/services/auth.js`: `getProviderCredentials` — resolves aliases, filters locked accounts, round-robin/fill-first strategies
- Connection-level lockout: exponential cooldown (1h, 2h, 3h...) on 401/403 from suspicious-activity or credentials-expired
- Model-level locks: `modelLockCount_${model}` tracking
- Token refresh: in-flight dedup via `inflightRefresh` Map

## PWA / Offline Layers

- Manifest: `src/app/manifest.webmanifest`
- Service worker: `public/sw.js` + `ServiceWorkerRegistrar`
- Offline read: `offlineJsonCache` (stale-while-revalidate)
- Offline write: `offlineMutationQueue` + `OfflineMutationProcessor` + `OfflineSyncStatus`

## Tunnels

- `src/lib/tunnel/`: Cloudflare (`cloudflared` binary) + Tailscale
- Serialized spawn via `spawnLock` with `killExistingProcess()`
- Docker entrypoint traps SIGTERM and forwards to all children
