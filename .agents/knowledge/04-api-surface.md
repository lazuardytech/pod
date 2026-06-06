# API Surface

## Compatibility Endpoints

- OpenAI-style: `/v1/chat/completions`, `/v1/responses`, `/v1/embeddings`, `/v1/images/generations`, `/v1/audio/speech`, `/v1/audio/transcriptions`, `/v1/search`, `/v1/web/fetch`
- Anthropic-style: `/v1/messages`, `/v1/messages/count_tokens`
- Gemini-style: `/v1beta/models` and subpaths
- Models listing: `/v1/models`, `/v1/models/[kind]`

## Dashboard/Management Endpoints

- Providers: CRUD, test, validate, suggest models, client-safe list, provider nodes, node rename, connection lock clear
- API Keys: CRUD, rate limit config (RPM + concurrent)
- Combos: CRUD (model fallback chains)
- Memory: CRUD (FTS5 search)
- Cache: view/clear semantic cache
- Settings: general, pricing, database, memory, cache config, migrate SQLite
- Usage: stats, history, logs, charts, request details, provider limits streams
- Proxy Pools: CRUD, test, streams, Vercel deploy
- Tunnels: Cloudflare enable/disable/status, Tailscale install/login/enable/disable

## Monitoring

- `/api/health`: Public heartbeat (used by Docker HEALTHCHECK)
- `/api/monitoring/health`: Full health (account lockout status, connection details) — protected
- `/api/monitoring/health/stream`: SSE health stream — protected
- SSE connection cap: 100 per route, idle timeout: 5 minutes

## Auth and Rate Limit Rules

- `/v1/*` write routes enforce API key rate limiting via `withApiKeyRateLimit`
- Model-list routes enforce auth when `requireApiKey=true`
- `/api/monitoring/health` and `/api/monitoring/health/stream` follow `requireApiKey`
- `/api/health` always public
- `/api/restart` and `/api/shutdown` require `SHUTDOWN_SECRET`
- Dashboard routes + internal APIs protected via `dashboardGuard.js` middleware

## Security

- All API routes use `sanitizeError()` in catch blocks
- All mutation routes use `parseJsonBody()` for safe JSON parsing
- Upstream API bodies never forwarded to clients
- SSRF guardrails: block `0.0.0.0` and DNS-rebinding patterns

## Cloud Endpoints

- Model alias, model resolution, credentials update, auth
- Cloud sync scheduling (`cloudSyncScheduler.js`)
