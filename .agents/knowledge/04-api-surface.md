# API Surface

All public compatibility endpoints are routed through rewrites in `next.config.mjs`:

- `/v1/:path*` -> `/api/v1/:path*`
- `/codex/:path*` -> `/api/v1/responses`

## Public Compatibility APIs

### OpenAI-compatible

- `POST /v1/chat/completions`
- `POST /v1/responses`
- `POST /v1/responses/compact`
- `POST /v1/embeddings`
- `POST /v1/audio/speech`
- `POST /v1/audio/transcriptions`
- `POST /v1/images/generations`
- `GET /v1/models`
- `GET /v1/models/{kind}` 
- `POST /v1/search`
- `POST /v1/web/fetch`

### Anthropic-compatible

- `POST /v1/messages`
- `POST /v1/messages/count_tokens`

### Gemini-compatible

- `GET /v1beta/models`
- `* /v1beta/models/{...path}`

> **Auth note**: `GET /v1/models`, `GET /v1/models/[kind]`, and `GET /v1beta/models` enforce API key auth when `requireApiKey=true`. These were previously unauthenticated.

### Ollama-compatible

- `POST /v1/api/chat`

## Per-Key Rate Limiting on `/v1/*`

All major `/api/v1/*` POST routes are wrapped by:
- `src/app/api/v1/_utils/apiKeyRateLimit.js`

Behavior:
- `unlimited`: no limiter
- `limited`: enforces both req/min and concurrent request ceilings
- 429 response with `Retry-After` when exceeded

## Dashboard and Management APIs (non-`/v1`)

Important groups under `src/app/api/`:

- Auth/session: `auth/*`
- Providers and nodes: `providers/*`, `provider-nodes/*`
  - `PATCH /api/provider-nodes/[id]/rename` — rename a custom provider node identifier (atomic cascade, custom nodes only)
- API keys: `keys/*`
- Combos: `combos/*`
- Usage analytics: `usage/*`
- Settings: `settings/*`
- Memory and cache:
  - `GET|DELETE /api/cache`
  - `GET|PUT /api/settings/cache-config`
  - `GET|POST /api/memory`
  - `GET|PATCH|DELETE /api/memory/[id]`
  - `GET|PUT /api/settings/memory`
- Tunnel/network ops: `tunnel/*`, `proxy-pools/*`
- Translator/debug: `translator/*`, `console-log`

## Pricing Sync API

| Endpoint | Description |
|---|---|
| `GET /api/pricing/sync` | Returns models.dev sync status (last sync time, model count, interval) |
| `POST /api/pricing/sync` | Triggers an immediate models.dev pricing sync |

Sync runs automatically on boot via `startPeriodicSync()` in `initializeApp.js`. Interval controlled by `modelCostSyncIntervalHours` in settings (default 1h).

## Tunnel API

| Endpoint | Description |
|---|---|
| `POST /api/tunnel/enable` | Spawns cloudflared and returns immediately. No DNS warmup delay. `fetchData()` refresh is non-fatal. |
| `POST /api/tunnel/disable` | Stops cloudflared tunnel |
| `GET /api/tunnel/status` | Returns current tunnel status |

## SSE Streaming Endpoints

Three live-stream endpoints use Server-Sent Events:

| Endpoint | Description |
|---|---|
| `GET /api/usage/request-logs/stream` | Live stream of incoming request log entries |
| `GET /api/proxy-pools/stream` | Live stream of proxy pool events |
| `GET /api/console-log` | Console log stream (existing) |

All SSE endpoints follow the same `open-sse` stream helper pattern.

## Monitoring & Health

### `GET /api/health` — Public liveness probe

Returns `{ ok: true }`. Always public — no API key required. Used by Docker `HEALTHCHECK` and Kubernetes liveness probes.

```bash
curl https://pod.lazuardy.tech/api/health
```

### `GET /api/monitoring/health` — Full health snapshot

Returns a comprehensive JSON snapshot of pod runtime state. **Protected by API key when `settings.requireApiKey=true`** (mirrors `/v1/models` auth pattern). When `requireApiKey=false`, the endpoint is public (self-hosted single-user).

```bash
# Without auth (when requireApiKey=false)
curl https://pod.lazuardy.tech/api/monitoring/health

# With API key (when requireApiKey=true)
curl -H "Authorization: Bearer YOUR_API_KEY" https://pod.lazuardy.tech/api/monitoring/health
# or
curl -H "x-api-key: YOUR_API_KEY" https://pod.lazuardy.tech/api/monitoring/health
```

#### Response shape

| Field | Type | Description | Source |
|---|---|---|---|
| `status` | `string` | `"healthy"` or `"issues"` | Derived from SQLite `PRAGMA integrity_check` |
| `timestamp` | `number` | Unix epoch ms at snapshot time | `Date.now()` |
| `version` | `object` | `{ pod, bun, node }` — pod display version, bun runtime version, node version | `config.js`, `process.versions`, `process.version` |
| `system` | `object` | Raw system metrics: uptime, memory, load, cpus, platform | `os` module, `process.memoryUsage()` |
| `system.memoryUsageHumanized` | `object` | `{ rss, heapUsed, heapTotal }` — human-readable strings (e.g. `"234 MB"`) | `process.memoryUsage()` |
| `system.memoryPressure` | `number` | `heapUsed / heapTotal` ratio, 0–1 | `process.memoryUsage()` |
| `system.memoryPressurePercent` | `string` | Human-readable e.g. `"70.2%"` | `process.memoryUsage()` |
| `system.processStartedAt` | `string` | ISO timestamp of pod process start | `globalThis.__pod_start_time` |
| `runtime` | `object` | `{ memoryUsageHumanized, memoryPressure, memoryPressurePercent, dataDirSizeBytes, dataDir, processStartedAt }` | `process.memoryUsage()`, `fs.statSync` |
| `database` | `object` | SQLite health: `{ ok, schemaVersion, integrity, sizeBytes, journalMode }` | `src/lib/sqlite/connection.js` |
| `providers` | `object` | `{ total, enabled, combos, apiKeys, byStatus, byProvider }` | `src/lib/localDb.js` |
| `providers.byStatus` | `object` | `{ active, error, untested, rateLimited, modelLocked }` — counts per status | Connection scan |
| `providers.byProvider` | `object` | `{ [provider]: { total, active, error, rateLimited } }` — per-provider breakdown | Connection scan |
| `tunnel` | `object` | `{ cloudflareEnabled, cloudflareUrl, tailscaleEnabled, tailscaleUrl }` | Settings |
| `semanticCache` | `object` | Legacy field: `{ enabled, maxSize, ttlMs }` | Settings |
| `caches` | `object` | Per-cache occupancy stats (see below) | Live cache instances |
| `caches.semanticCache` | `object` | `{ enabled, memoryEntries, dbEntries, hits, misses, hitRate, tokensSaved, ttlMs }` | `getCacheStats()` in `semanticCache.js` |
| `caches.promptCache` | `object` | `{ enabled, currentSize, maxSize, currentBytes, maxBytes, hitRate, hits, misses, evictions, ttlMs }` | `LRUCache.getStats()` in `cacheLayer.js` |
| `caches.memoryStore` | `object` | `{ size, maxSize, bytes, maxBytes, hitRate, hits, misses }` | `LRUCache.getStats()` in `memory/store.js` |
| `caches.connectionNameCache` | `object` | `{ size, maxSize, bytes, maxBytes }` | `LRUCache.getStats()` in `usageDb.js` |
| `inFlight` | `object` | `{ count }` — thundering herd dedup map size | `inFlightRequests` Map in `semanticCache.js` |
| `pending` | `object` | `{ total, byProvider }` — active request tracker | `global._pendingRequests` in `usageDb.js` |
| `sync` | `object` | `{ modelsDev: { enabled, intervalHours, lastSyncAt, lastSyncOk, lastError }, cloud: { enabled, lastSyncAt } }` | `modelsDevSync.js`, `cloudSyncScheduler.js` |
| `queueDepths` | `object` | `{ logQueue, summaryQueue }` — internal write queue lengths | `usageDb.js` |
| `providerHealth` | `array` | Per-provider circuit breaker state (OPEN/HALF_OPEN/CLOSED) | Connection scan |
| `rateLimitStatus` | `array` | Per-provider rate-limit details with per-connection breakdown | Connection scan |
| `blockedModelStatus` | `array` | Per-model lock details with per-connection breakdown | Connection scan |

### `GET /api/monitoring/health/stream` — SSE stream

Server-Sent Events stream pushing a full `buildHealthPayload()` snapshot every 10 seconds with 25-second keepalive heartbeats. **Protected by API key when `requireApiKey=true`**, same as the snapshot endpoint.

```bash
curl -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Accept: text/event-stream" \
  https://pod.lazuardy.tech/api/monitoring/health/stream
```

Implementation: `src/app/api/monitoring/health/stream/route.js` and `src/app/api/monitoring/health/_health.js`.

## API Key Validation Model

- Public auth can be enforced by `settings.requireApiKey`
- Accepted headers: `Authorization: Bearer ...` or `x-api-key`
- Key format parsing/validation lives in `src/shared/utils/apiKey.js`
- Auth enforcement mirrors `/v1/models` pattern — uses `extractApiKey()` + `isValidApiKey()` from `src/sse/services/auth.js` for monitoring endpoints
