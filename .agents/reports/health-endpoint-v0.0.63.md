# Health Endpoint Enrichment — v0.0.63

## Why

Pod runs on RAM-constrained hosts (~1 GB). Without visibility into memory pressure, cache occupancy, in-flight dedup, sync status, and provider health breakdown, remote monitoring after deploy is blind. This enrichment exposes every resource and runtime signal needed for external alerting (Grafana, Datadog, cron polling) in a single authenticated JSON snapshot.

## Auth Model

| Endpoint | Auth when `requireApiKey=true` | Purpose |
|---|---|---|
| `GET /api/health` | **Never** — always public | Docker `HEALTHCHECK`, K8s liveness probe |
| `GET /api/monitoring/health` | Required — 401 on miss/invalid | Full runtime snapshot |
| `GET /api/monitoring/health/stream` | Required — 401 on miss/invalid | SSE push every 10s |

Auth uses `extractApiKey()` from `src/sse/services/auth.js` (checks `Authorization: Bearer ...` then `x-api-key`), then `validateApiKey()` from `src/lib/localDb.js`. Mirrors the `/v1/models` pattern exactly.

## Per-Section Field Reference

### `version`

| Field | Type | Description |
|---|---|---|
| `pod` | `string` | Display version from `src/shared/constants/config.js` `displayVersion` |
| `bun` | `string \| null` | Bun runtime version (`process.versions.bun`) |
| `node` | `string` | Node.js version (`process.version`) |

### `system` (extended)

Previous fields (uptime, nodeVersion, platform, arch, memoryUsage, loadAvg, cpus, freeMemory, totalMemory) are unchanged. New sub-fields:

| Field | Type | Description |
|---|---|---|
| `memoryUsageHumanized` | `{ rss, heapUsed, heapTotal }` | Human-readable strings like `"234 MB"` |
| `memoryPressure` | `number` | `heapUsed / heapTotal`, 0–1, four decimal precision |
| `memoryPressurePercent` | `string` | Human-readable like `"70.2%"` |
| `processStartedAt` | `string` | ISO 8601 timestamp when the pod process started |

### `runtime`

Convenience envelope for external monitors that only want the high-signal fields:

| Field | Type | Description |
|---|---|---|
| `memoryUsageHumanized` | `object` | Same as `system.memoryUsageHumanized` |
| `memoryPressure` | `number` | Same as `system.memoryPressure` |
| `memoryPressurePercent` | `string` | Same as `system.memoryPressurePercent` |
| `dataDirSizeBytes` | `number \| null` | Size of `~/.pod/pod.sqlite` in bytes (best-effort) |
| `dataDir` | `string \| null` | Human-readable size (e.g. `"1.0 MB"`) |
| `processStartedAt` | `string` | Same as `system.processStartedAt` |

### `caches`

Four sub-objects, one per cache layer. All stats come from live `LRUCache.getStats()` or equivalent.

#### `caches.semanticCache`

In-memory LRU + SQLite-durable semantic cache for identical prompts.

| Field | Type | Description |
|---|---|---|
| `enabled` | `boolean` | Whether semantic caching is on |
| `memoryEntries` | `number` | Entries currently in the LRU |
| `dbEntries` | `number` | Non-expired rows in SQLite |
| `hits` | `number` | Cumulative cache hits |
| `misses` | `number` | Cumulative cache misses |
| `hitRate` | `string` | Percentage like `"83.3"` |
| `tokensSaved` | `number` | Total tokens avoided by cache hits |
| `ttlMs` | `number` | Configured TTL in ms |

Source: `getCacheStats()` in `src/lib/semanticCache.js`.

#### `caches.promptCache`

Short-TTL LRU cache for prompt prefix dedup.

| Field | Type | Description |
|---|---|---|
| `enabled` | `boolean` | Always `true` |
| `currentSize` | `number` | Current entry count |
| `maxSize` | `number` | Max entries |
| `currentBytes` | `number` | Estimated byte usage |
| `maxBytes` | `number` | Byte ceiling |
| `hitRate` | `string` | Percentage like `"80.8%"` |
| `hits` | `number` | Cumulative hits |
| `misses` | `number` | Cumulative misses |
| `evictions` | `number` | Entries evicted by pressure |
| `ttlMs` | `number` | Configured TTL |

Source: `getPromptCache().getStats()` in `src/lib/cacheLayer.js`.

#### `caches.memoryStore`

LRU for memory (facts/decisions) lookups.

| Field | Type | Description |
|---|---|---|
| `size` | `number` | Current entry count |
| `maxSize` | `number` | Max entries (500) |
| `bytes` | `number` | Estimated byte usage |
| `maxBytes` | `number` | Byte ceiling (4 MB) |
| `hitRate` | `string` | Percentage |
| `hits` | `number` | Cumulative hits |
| `misses` | `number` | Cumulative misses |

Source: `getMemoryStoreStats()` in `src/lib/memory/store.js`.

#### `caches.connectionNameCache`

LRU for connection ID → display name resolution.

| Field | Type | Description |
|---|---|---|
| `size` | `number` | Current entries |
| `maxSize` | `number` | Max entries (500) |
| `bytes` | `number` | Estimated byte usage |
| `maxBytes` | `number` | Byte ceiling |

Source: `getConnectionNameCacheStats()` in `src/lib/usageDb.js`.

### `inFlight`

Thundering herd dedup map — tracks how many identical requests are currently being processed upstream, preventing N parallel cache misses from all hitting the provider.

| Field | Type | Description |
|---|---|---|
| `count` | `number` | Current size of the `inFlightRequests` Map |

Source: `getInFlightStats()` in `src/lib/semanticCache.js`.

### `pending`

Tracks in-flight request counts by provider, used by the dashboard for live request monitoring.

| Field | Type | Description |
|---|---|---|
| `total` | `number` | Total pending requests across all providers |
| `byProvider` | `{ [provider]: number }` | Pending count per provider name |

Source: `getPendingStats()` in `src/lib/usageDb.js`.

### `sync`

Background periodic sync status.

#### `sync.modelsDev`

| Field | Type | Description |
|---|---|---|
| `enabled` | `boolean` | Whether periodic sync is active |
| `intervalHours` | `number` | Configured interval in hours |
| `lastSyncAt` | `string \| null` | ISO timestamp of last successful sync |
| `lastSyncOk` | `boolean` | Whether last sync succeeded (inferred from `lastSyncAt != null`) |
| `lastError` | `string \| null` | Error message from last failed sync, or null |

Source: `getSyncStatus()` in `src/lib/modelsDevSync.js`.

#### `sync.cloud`

| Field | Type | Description |
|---|---|---|
| `enabled` | `boolean` | Whether cloud sync scheduler is instantiated |
| `lastSyncAt` | `string \| null` | ISO timestamp of last successful cloud sync |

Source: `getCloudSyncStatus()` in `src/shared/services/cloudSyncScheduler.js`.

### `providers.byStatus`

Counts of provider connections by health status:

| Field | Type | Description |
|---|---|---|
| `active` | `number` | `testStatus === "active"` and not rate-limited |
| `error` | `number` | `testStatus === "error"` or `"unavailable"` |
| `untested` | `number` | No `testStatus` set |
| `rateLimited` | `number` | Currently rate-limited (`rateLimitedUntil` in the future) |
| `modelLocked` | `number` | Has at least one active `modelLock_*` key |

### `providers.byProvider`

Per-provider breakdown: `{ [provider]: { total, active, error, rateLimited } }`.

## How to Consume from External Monitors

### Grafana / Datadog / Prometheus

Poll `GET /api/monitoring/health` every 15–30 seconds with a Bearer token. Key alerting rules:

- `runtime.memoryPressure` > 0.85 → heap pressure
- `system.memoryUsage.rss` > 900 MB → approaching RAM ceiling on 1 GB hosts
- `database.integrity !== "ok"` → SQLite corruption
- `providers.byStatus.rateLimited > 0` → upstream rate limits active
- `caches.semanticCache.hitRate` trend → cache efficiency regression
- `inFlight.count` spike → thundering herd
- `sync.modelsDev.lastSyncAt` stale > 2× interval → sync stuck

### Simple cron

```bash
#!/bin/bash
curl -sf -H "Authorization: Bearer $POD_API_KEY" \
  https://pod.lazuardy.tech/api/monitoring/health | \
  jq '{status, memory: .runtime.memoryPressurePercent, heap: .system.memoryUsageHumanized.heapUsed, providers: .providers.byStatus}'
```

### SSE stream for real-time dashboards

```bash
curl -N -H "Authorization: Bearer $POD_API_KEY" \
  -H "Accept: text/event-stream" \
  https://pod.lazuardy.tech/api/monitoring/health/stream | \
  jq --unbuffered '.runtime.memoryPressurePercent'
```

## Memory Budget Reference

| Cache | Max Entries | Max Bytes | Env Vars |
|---|---|---|---|
| Semantic (LRU) | 100 (default) | 4 MB (default) | `SEMANTIC_CACHE_MAX_SIZE`, `SEMANTIC_CACHE_MAX_BYTES` |
| Semantic (SQLite) | Unlimited | Disk-bound | N/A |
| Prompt | 50 | 2 MB | `PROMPT_CACHE_MAX_SIZE`, `PROMPT_CACHE_MAX_BYTES` |
| Memory Store | 500 | 4 MB | Hardcoded |
| Connection Name | 500 | 4 MB | Hardcoded |

Total LRU ceiling: ~14 MB. SQLite file grows with semantic cache rows and daily summaries.

## Known Limitations

- **`database.integrity`** is cached for 5 minutes (`INTEGRITY_CACHE_TTL_MS`). Force-fresh is not exposed; you must wait for TTL expiry.
- **`dataDirSizeBytes`** only measures `pod.sqlite`, not the full `~/.pod/` directory (logs, WAL, etc. are excluded). This is intentional — `du` on a directory tree is blocking and too slow for a health endpoint.
- **`caches.semanticCache.hitRate`** is a cumulative percentage from DB metrics — it includes hits from the previous process lifetime (persisted in `cache_metrics` table).
- **`sync.cloud.lastSyncAt`** is `null` until the first successful cloud sync completes after process start.
- **`pending.byProvider`** counts are in-memory and reset to zero on process restart.