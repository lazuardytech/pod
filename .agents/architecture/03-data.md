# Data Layer — SQLite, Cache, Memory

Pod uses SQLite as its single-file database, with FTS5 for full-text search on memories. All data access goes through `src/lib/localDb.js`.

## Database

### Connection (`src/lib/sqlite/connection.js`)
- `bun:sqlite` singleton via `getDatabase()`
- Opens `~/.pod/pod.sqlite` (auto-creates directory)
- WAL mode (`PRAGMA journal_mode=WAL`)
- Auto-runs schema on first connect
- `tx()` helper for transactional operations

### Schema (`src/lib/sqlite/schema.js`)
Tables:

| Table | Purpose |
|-------|---------|
| `provider_connections` | Provider credentials (OAuth tokens, API keys, cookies) |
| `provider_nodes` | Custom compatible nodes (openai-compatible-*, etc.) |
| `api_keys` | Pod API keys with rate limit config (rpm, concurrent) |
| `model_aliases` | User-defined model aliases |
| `custom_models` | Custom model definitions |
| `combos` | Model fallback chain configurations |
| `proxy_pools` | Outbound proxy pool definitions |
| `settings` | Key-value app settings |
| `pricing` | Model pricing data |
| `usage_history` | Aggregated usage records |
| `daily_summary` | Per-day usage summaries |
| `request_details` | Per-request detail records |
| `request_log` | Request log entries (ring buffer) |
| `semantic_cache` | Cached responses with embeddings |
| `cache_metrics` | Cache hit/miss counters |
| `memories` | Conversational memory entries |
| `memory_fts` | FTS5 virtual table for memory search (with triggers for auto-sync) |

### Data Access (`src/lib/localDb.js`)
Central facade with 35+ consumer functions:

- **Provider connections**: `getProviderConnections`, `getProviderConnection`, `createProviderConnection`, `updateProviderConnection`, `deleteProviderConnection`, `updateProviderCredentials`, `clearProviderConnections`
- **API keys**: `getApiKeys`, `getApiKeyByKey`, `getApiKeyById`, `createApiKey`, `updateApiKey`, `deleteApiKey`
- **Models**: `getModelAliases`, `setModelAlias`, `deleteModelAlias`, `getCustomModels`, `createCustomModel`, `deleteCustomModel`, `getDisabledModels`, `addDisabledModel`, `removeDisabledModel`
- **Settings**: `getSetting`, `setSetting`, `getSettings`, `updateSettings`
- **Usage**: `getUsageStats`, `getUsageHistory`, `getUsageLogs`, `getChartData`, `getRequestLogs`, `getRequestDetail`, `getDailySummary`, `logUsage`, `logRequest`
- **Pricing**: `getPricingData`, `updatePricingData`, `syncPricing`
- **Combos**: `getCombos`, `getCombo`, `createCombo`, `updateCombo`, `deleteCombo`
- **Proxy pools**: `getProxyPools`, `getProxyPool`, `createProxyPool`, `updateProxyPool`, `deleteProxyPool`
- **Provider nodes**: `getProviderNodes`, `getProviderNode`, `createProviderNode`, `updateProviderNode`, `deleteProviderNode`, `renameProviderNode`

### Migration (`src/lib/sqlite/migrate-from-json.js`)
One-shot migration from legacy lowdb JSON files:
- `db.json` → `provider_connections`, `api_keys`, `model_aliases`, `settings`, `combos`, `proxy_pools`
- `usage.json` → `usage_history`, `daily_summary`
- `request-details.json` → `request_details`, `request_log`
- Original files renamed to `.bak` after successful migration

## Semantic Cache

### Architecture (`src/lib/cacheLayer.js`, `src/lib/semanticCache.js`)
- Embedding-based similarity matching
- Thundering herd prevention (single flight)
- Signature includes `memoryOwnerId` for per-user isolation
- Temperature normalization in cache key
- TTL comparisons use `strftime('%Y-%m-%dT%H:%M:%SZ', 'now')` (ISO-8601)

### Operations
- `checkSemanticCache`: Check if similar request exists in cache
- `saveToSemanticCache`: Store response with embedding
- `invalidateCacheByModel`: Targeted eviction via `forEach()` (not `clear()`)
- Supports streaming cache (cacheable even when `stream: true`)

## Conversational Memory

### Subsystem (`src/lib/memory/`)

| File | Purpose |
|------|---------|
| `store.js` | CRUD with LRU cache, FTS5 search |
| `extraction.js` | Fact extraction from LLM responses (regex, dedup by fact key) |
| `retrieval.js` | FTS5 semantic/hybrid/exact search, keyword scoring, token budget |
| `injection.js` | Format memory as system/user message, provider-aware |
| `settings.js` | Config normalization |
| `types.js` | Memory type enum: factual, episodic, procedural, semantic |

### Flow
1. User sends chat request → `retrieval.js` finds relevant memories via FTS5
2. `injection.js` injects memories into system/user message
3. LLM responds → `extraction.js` parses facts in background (`setImmediate`)
4. `store.js` persists new memories with dedup

## Usage Tracking

### Flow
1. `open-sse/handlers/chatCore/requestDetail.js` builds request detail object
2. After response: `logUsage()` and `logRequest()` persist to SQLite
3. Dashboard queries via `api/usage/*` routes for analytics
4. Request log is a ring buffer with configurable retention

### Data Collected
- Model, provider, connection ID
- Token counts (input, output, reasoning)
- Request/response timestamps
- Latency metrics
- Error codes and statuses
