# Data Architecture

## Local-First Design

Pod uses a local-first storage model:

- **SQLite** is the primary store at `~/.pod/pod.sqlite`
- **Browser offline** supports reads when the client is disconnected
- **Redis** is optional (enabled when `REDIS_URL` is set)

## Key Files

| File | Role |
|---|---|
| `src/lib/sqlite/connection.js` | Connection management, transaction helpers |
| `src/lib/sqlite/schema.js` | Table definitions and migration logic |
| `src/lib/localDb.js` | Primary database access layer (preferred entry point) |
| `src/lib/usageDb.js` | Usage tracking and billing data |

## Cache Layers

- **semanticCache.js** — Semantic caching of LLM responses. Cache signatures include `memoryOwnerId`. Backed by Redis or in-memory fallback. TTL comparisons use `strftime('%Y-%m-%dT%H:%M:%SZ', 'now')`.
- **promptCache.js** — Cached prompt templates and system prompts.
- **offlineJsonCache.js** — Offline-first read cache for dashboard data.

## Offline Mutation Queue

Offline writes are queued for replay when connectivity returns. Only safe, idempotent dashboard mutations are queued — non-idempotent operations are refused when offline.

## Rules

- **Prefer `localDb.js`**: All storage access should go through `localDb.js` rather than calling `connection.js` directly, unless the operation needs raw SQLite access.
- **strftime-based TTL**: SQLite cache TTL comparisons must use `strftime('%Y-%m-%dT%H:%M:%SZ', 'now')` for consistent time handling.
- **Transactional lock writes**: Connection locking must stay transactional to prevent race conditions on model-level concurrency.
- **Cache invalidation is correctness**: Stale cache data can produce incorrect LLM responses. Cache invalidation paths are treated with the same care as primary data writes.
