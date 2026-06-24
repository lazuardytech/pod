# Data Architecture

## Storage Model

Pod uses a local-first storage model:

| Layer | Technology | When |
|-------|-----------|------|
| Primary store | SQLite (`~/.pod/pod.sqlite`) | Always |
| Distributed cache | Redis (`REDIS_URL` set) | Optional, for multi-instance |
| In-memory fallback | Node.js Map/Set | When Redis unavailable |
| Browser offline | offlineJsonCache (IndexedDB) | Client disconnected |

## Key Files

| File | Role |
|------|------|
| `src/lib/localDb.js` | Primary database access layer (preferred entry point) |
| `src/lib/sqlite/connection.js` | Connection management, transaction helpers |
| `src/lib/sqlite/schema.js` | Table definitions and migrations |
| `src/lib/usageDb.js` | Usage tracking and billing data |
| `src/lib/requestDetailsDb.js` | Observability request-detail storage |
| `src/lib/disabledModelsDb.js` | Disabled model tracking |

**Rule**: All storage access goes through `localDb.js` unless raw SQLite access is needed.

## Cache Layers

### Semantic Cache (`src/lib/semanticCache.js`)
- Caches LLM responses based on semantic similarity
- Cache signatures include `memoryOwnerId`
- TTL comparisons use `strftime('%Y-%m-%dT%H:%M:%SZ', 'now')`
- Backed by Redis or in-memory fallback
- Thundering herd protection via in-flight deduplication
- Configurable via env vars: `SEMANTIC_CACHE_MAX_BYTES`, `SEMANTIC_CACHE_MAX_SIZE`, `SEMANTIC_CACHE_TTL_MS`

### Prompt Cache (`promptCache.js`)
- Caches repeated system prompts
- Configurable via env vars: `PROMPT_CACHE_MAX_BYTES`, `PROMPT_CACHE_MAX_SIZE`, `PROMPT_CACHE_TTL_MS`

### Offline JSON Cache (`offlineJsonCache.js`)
- Browser-side read cache for dashboard data
- Tag-based invalidation after safe mutations
- Service worker integration

## Rate Limiting (`src/lib/rateLimit/`)

| Backend | When | Scope |
|---------|------|-------|
| Redis | `REDIS_URL` set | Distributed (shared across instances) |
| In-memory | Redis unavailable | Single-instance only |

### Backend Selection Rules
- Duck-type checks (never `constructor.name` or `instanceof`) -- breaks in minified builds
- Redis RPM entries must stay unique per hit
- If concurrent admission fails after RPM admission, release the RPM slot

### Rate Limit Scope
- Per-API-key: `requests_per_minute` + `concurrent_requests`
- Per-provider: lockout tracking and cooldown

## Memory Pipeline (`src/lib/memory/`)

- Automatic memory extraction from conversations
- Memory injection into subsequent requests
- Memory-aware cache signatures (memoryOwnerId in cache key)
- Memory retrieval and persistence

## Offline Mutation Queue

- Only safe, idempotent dashboard mutations are queued
- Non-idempotent operations are refused when offline
- Queue replays when connectivity returns
- Reads use `offlineJsonCache`; writes use the mutation queue

## Rules

| Rule | Why |
|------|-----|
| Prefer `localDb.js` | Consistent access pattern, easier to reason about |
| strftime-based TTL | Consistent time handling across SQLite versions |
| Transactional lock writes | Prevent race conditions on model-level concurrency |
| Cache invalidation is correctness | Stale cache leads to incorrect LLM responses |
| Duck-type rate limit checks | `instanceof` breaks in minified builds |
