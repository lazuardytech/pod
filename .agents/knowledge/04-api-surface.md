# API Surface

All public endpoints rewrite via `next.config.mjs`: `/v1/:path*` → `/api/v1/:path*`, `/codex/:path*` → `/api/v1/responses`.

## Public Compatibility Endpoints

### OpenAI-Compatible

| Endpoint | Auth |
|---|---|
| `POST /v1/chat/completions` | API key + rate limit |
| `POST /v1/responses` | API key + rate limit |
| `POST /v1/responses/compact` | API key + rate limit |
| `POST /v1/embeddings` | API key + rate limit |
| `POST /v1/audio/speech` | API key + rate limit |
| `POST /v1/audio/transcriptions` | API key + rate limit |
| `POST /v1/images/generations` | API key + rate limit |
| `GET /v1/models` | API key (optional, enforced when `requireApiKey=true`) |
| `GET /v1/models/{kind}` | API key (optional, enforced when `requireApiKey=true`) |
| `POST /v1/search` | API key + rate limit |
| `POST /v1/web/fetch` | API key + rate limit |

### Anthropic-Compatible

| Endpoint | Auth |
|---|---|
| `POST /v1/messages` | API key + rate limit |
| `POST /v1/messages/count_tokens` | API key + rate limit |

### Gemini-Compatible

| Endpoint | Auth |
|---|---|
| `GET /v1beta/models` | API key (enforced when `requireApiKey=true`) |
| `* /v1beta/models/{...path}` | API key |

### Ollama-Compatible

| Endpoint | Auth |
|---|---|
| `POST /v1/api/chat` | API key + rate limit |

## Dashboard & Management APIs

| Group | Endpoints |
|---|---|
| Auth | `POST /api/auth/login`, `POST /api/auth/logout` |
| Providers | `providers/*`, `provider-nodes/*` (CRUD, test, rename, validate) |
| API Keys | `keys/*` |
| Combos | `combos/*` |
| Usage | `usage/*` (stats, chart, history, logs, stream, request-details) |
| Cache | `GET/DELETE /api/cache`, `GET/PUT /api/settings/cache-config` |
| Memory | `GET/POST /api/memory`, `GET/PATCH/DELETE /api/memory/[id]` |
| Settings | `settings/*` (appearance, database, proxy, cache, memory, pricing) |
| Tunnel | `tunnel/*` (status, enable, disable, tailscale-*) |
| Proxy Pools | `proxy-pools/*` (CRUD, test, stream, vercel-deploy) |
| OAuth | `oauth/[provider]/*` (authorize, exchange, device-code, poll, import) |
| Translator | `translator/*` (load, save, send, translate, console-logs) |
| Pricing | `GET/POST /api/pricing/sync` |
| Cloud | `cloud/*` (sync, auth, credentials, models) |
| Monitoring | `GET /api/health` (public), `GET /api/monitoring/health` (auth) + SSE stream |

## SSE Streaming Endpoints

| Endpoint | Description |
|---|---|
| `GET /api/usage/request-logs/stream` | Live request log entries |
| `GET /api/proxy-pools/stream` | Proxy pool events |
| `GET /api/console-log` | Console logs stream |
| `GET /api/monitoring/health/stream` | Health snapshot every 10s |

## Per-Key Rate Limiting

`withApiKeyRateLimit` wraps all `/api/v1/*` POST routes. Enforces:
- **unlimited**: no limiter
- **limited**: req/min + concurrent request ceilings
- 429 with `Retry-After` when exceeded
- In-memory counters (single-process only — commented warning)

## Health Monitoring

**`GET /api/health`** — Always public. Returns `{ ok: true }`. Used by Docker HEALTHCHECK.

**`GET /api/monitoring/health`** — Full snapshot: system info, DB health, provider breakdown (by status/by provider), circuit breaker states, rate-limit status, model lockouts, cache stats (semantic/prompt/memory/connection-name), in-flight requests, pending requests, sync status, queue depths. Protected when `requireApiKey=true`.

**`GET /api/monitoring/health/stream`** — SSE stream of full snapshots every 10s. Same auth as snapshot.
