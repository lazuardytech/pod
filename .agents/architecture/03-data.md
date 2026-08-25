# Data Architecture

## Storage Model

Pod uses a local-first storage model:

| Layer              | Technology                   | When                                              |
| ------------------ | ---------------------------- | ------------------------------------------------- |
| Primary store      | SQLite (`~/.pod/pod.sqlite`) | Always                                            |
| Rate-limit backend | Redis (`REDIS_URL` set)      | Optional; **rate limits only** (not a data store) |
| In-memory fallback | Node.js Map/Set              | When Redis unavailable                            |
| Browser offline    | offlineJsonCache (IndexedDB) | Client disconnected                               |

## Key Files

| File                           | Role                                                  |
| ------------------------------ | ----------------------------------------------------- |
| `src/lib/localDb.ts`           | Primary database access layer (preferred entry point) |
| `src/lib/sqlite/connection.ts` | Connection management, WAL checkpoint on close        |
| `scripts/sqlite-backup.ts`     | `VACUUM INTO` backup under `$DATA_DIR/backups`        |
| `src/lib/sqlite/schema.ts`     | Table definitions and migrations                      |
| `src/lib/usageDb.ts`           | Usage tracking and billing data                       |
| `src/lib/requestDetailsDb.ts`  | Observability request-detail storage                  |
| `src/lib/disabledModelsDb.ts`  | Disabled model tracking                               |

**Rule**: All storage access goes through `localDb.ts` unless raw SQLite access is needed.

## Cache Layers

### Semantic Cache (`src/lib/semanticCache.ts`)

- Caches LLM responses based on semantic similarity
- Cache signatures include `memoryOwnerId`
- TTL comparisons use `strftime('%Y-%m-%dT%H:%M:%SZ', 'now')`
- Backed by in-process LRU + per-instance SQLite only
- Thundering herd protection via in-flight deduplication
- Configurable via env vars: `SEMANTIC_CACHE_MAX_BYTES`, `SEMANTIC_CACHE_MAX_SIZE`, `SEMANTIC_CACHE_TTL_MS`

### Prompt Cache

- Caches repeated system prompts
- Configurable via env vars: `PROMPT_CACHE_MAX_BYTES`, `PROMPT_CACHE_MAX_SIZE`, `PROMPT_CACHE_TTL_MS`

### Offline JSON Cache (`offlineJsonCache.ts`)

- Browser-side read cache for dashboard data
- Tag-based invalidation after safe mutations
- Complements SW shell caching (`public/sw.js` network-first navigations; see gotcha §34)

## Rate Limiting (`src/lib/rateLimit/`)

| Backend   | When              | Scope                                                                                         |
| --------- | ----------------- | --------------------------------------------------------------------------------------------- |
| Redis     | `REDIS_URL` set   | Rate-limit keys only; isolate with `RATELIMIT_KEY_PREFIX` (`local:` / `pod:` / `pod-canary:`) |
| In-memory | Redis unavailable | Single process                                                                                |

### Backend Selection Rules

- Duck-type checks (never `constructor.name` or `instanceof`) — breaks in minified builds
- Redis RPM entries must stay unique per hit
- If concurrent admission fails after RPM admission, release the RPM slot
- Per-op Redis timeout via `RATELIMIT_REDIS_TIMEOUT_MS` (default 1000ms) — bounds each Redis call so a slow/hung Redis fails fast to the in-memory fallback
- Redis key isolation via `RATELIMIT_KEY_PREFIX` — namespaces rate-limit keys so prod and canary (or local tests) can share one Redis without colliding
- Replicas: **1**. `POD_REPLICA_COUNT>1` warns; throws in production. Backup: `bun scripts/sqlite-backup.ts` (`VACUUM INTO`). Shutdown runs `PRAGMA wal_checkpoint(TRUNCATE)`.

### Rate Limit Scope

- Per-API-key: `requests_per_minute` + `concurrent_requests`
- Per-provider: lockout tracking and cooldown

## Memory Pipeline (`src/lib/memory/`)

- Automatic memory extraction from conversations
- Memory injection into subsequent requests
- Memory-aware cache signatures (memoryOwnerId in cache key)
- Memory retrieval and persistence

## Offline Mutation Queue

- Enqueue allowlist only: `PATCH /api/settings`, `PUT /api/providers/:id`
- Non-idempotent / other paths are refused when offline (`not_allowed`)
- Queue replays when connectivity returns
- Reads use `offlineJsonCache`; writes use the mutation queue

## Rules

| Rule                              | Why                                                |
| --------------------------------- | -------------------------------------------------- |
| Prefer `localDb.ts`               | Consistent access pattern, easier to reason about  |
| strftime-based TTL                | Consistent time handling across SQLite versions    |
| Transactional lock writes         | Prevent race conditions on model-level concurrency |
| Cache invalidation is correctness | Stale cache leads to incorrect LLM responses       |
| Duck-type rate limit checks       | `instanceof` breaks in minified builds             |
