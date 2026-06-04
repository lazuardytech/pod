# Architecture

## Main Modules

- `src/`: Next.js app (dashboard UI + API routes)
- `open-sse/`: local routing engine, translators, executors
- `cloud/`: Cloudflare Worker companion

## Request Flow (high level)

1. Client calls compatibility endpoint (`/v1/*`, `/v1beta/*`, `/api/*`)
2. Next route applies auth + rate-limit checks (via `dashboardGuard.js` middleware + `src/lib/rateLimit/`)
3. Request enters `open-sse` routing pipeline
4. Model/provider resolution + fallback strategy
5. Optional cache read and memory injection
6. Provider executor call
7. Stream/JSON translation back to client format
8. Usage and logs persisted

## Data and Reliability Layers

- SQLite-backed configuration and usage storage
- Transactional connection-lock updates to avoid race conditions
- SSE connection caps and idle timeouts
- Graceful shutdown with queue flush (see `src/lib/shutdown.js`)

## Auth Middleware Layer

- `src/dashboardGuard.js` + `src/proxy.js`: JWT + CLI token matcher for all protected routes.
- `PROTECTED_API_PATHS` covers: `/api/settings`, `/api/keys`, `/api/providers/client`, `/api/provider-nodes`, `/api/memory`, `/api/cache`, `/api/models`, `/api/translator`, `/api/tunnel`.
- `ALWAYS_PROTECTED`: `/api/shutdown`, `/api/restart`, `/api/settings/database`, `/api/settings/migrate-sqlite`.
- Any new `/api/*` route that mutates state must be added to both lists and the `proxy.js` matcher.

## Rate Limiting Layer

- `src/lib/rateLimit/backend.js`: Auto-selects Redis or in-memory backend based on `REDIS_URL` env var.
- `src/lib/rateLimit/redis.js`: `RedisBackend` — sliding window RPM via Sorted Set, concurrent via `INCR/DECR`.
- `src/lib/rateLimit/memory.js`: `MemoryBackend` — in-process fallback.
- `src/lib/rateLimit/index.js`: Public API — `withApiKeyRateLimit(request, handler)`, `checkRateLimitByKey(key)`, `initRateLimit()`.
- Initialized at startup in `src/shared/services/initializeApp.js`.
- 15+ v1 API routes wrapped with `withApiKeyRateLimit`.

## EE Handling and Input Safety

- `src/lib/parseJsonBody.js` — safe JSON body parser (try/catch wrapper). Used in 45+ mutation routes.
- `src/lib/sanitizeError.js` — production-safe error messages (`"Internal server error"` in prod, `error.message` in dev). Used in 60+ API routes.
- Upstream API error bodies are never forwarded to the client — only generic status messages.

## SSE Crash Hardening

- `src/sse/handlers/chat.js`: `while(true)` fallback loop wrapped in `try/catch` with `MAX_FALLBACK_ITERATIONS=50` guard.
- `open-sse/utils/stream.js`: `transform()` and `flush()` methods wrapped in `try/catch` with graceful SSE error terminator + `controller.terminate()`.
- `open-sse/handlers/chatCore.js`: Peek `getReader()` and `reader.read()` both wrapped in `try/catch` with fallback.

## PWA / Offline Layers

- Manifest: `src/app/manifest.webmanifest`
- Service worker: `public/sw.js`
- Offline read cache: `offlineJsonCache`
- Offline write queue: `offlineMutationQueue`
- Background drain + status UI: `OfflineMutationProcessor`, `OfflineSyncStatus`
