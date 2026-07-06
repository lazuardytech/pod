# App Architecture (`src/`)

## Directory Layout

```
src/
  app/                Next.js App Router: pages + API routes
    (dashboard)/      Dashboard pages (route group, top-level URLs)
    api/              API routes (26 route groups)
    callback/         OAuth callback handlers
    landing/          Landing page
    login/            Login page
    offline/          Offline fallback page
  lib/                Backend services (storage, cache, rate limiting, auth, tunnels)
  sse/                SSE chat orchestration layer
  shared/             UI components, Zustand stores, constants, utils
  proxy.js            Next.js middleware (route matching)
  dashboardGuard.js   Auth guard (JWT verification)
  server-init.js      App initialization and global signal handlers
```

## Dashboard Pages

All 15 dashboard pages are top-level — no `/dashboard` prefix.

| Page            | Route              |
| --------------- | ------------------ |
| Endpoint        | `/endpoint`        |
| LLM Providers   | `/providers`       |
| Media Providers | `/media-providers` |
| Combos          | `/combos`          |
| Quota           | `/quota`           |
| Usage           | `/usage`           |
| Memory          | `/memory`          |
| Cache           | `/cache`           |
| Health          | `/health`          |
| Logs            | `/logs`            |
| Proxy Pools     | `/proxy-pools`     |
| Settings        | `/settings`        |
| Translator      | `/translator`      |
| Basic Chat      | `/basic-chat`      |
| Provider Nodes  | (via API)          |

## API Routes (26 groups)

| Route group            | Purpose                                         |
| ---------------------- | ----------------------------------------------- |
| `/v1/*`                | OpenAI-compatible inference endpoints           |
| `/v1beta/*`            | Gemini-compatible endpoints                     |
| `/api/auth`            | Dashboard authentication                        |
| `/api/health`          | Public health check                             |
| `/api/monitoring/*`    | Monitoring health (API key required)            |
| `/api/providers`       | Provider CRUD                                   |
| `/api/provider-nodes`  | Custom node management                          |
| `/api/media-providers` | Media provider management                       |
| `/api/combos`          | Combo CRUD                                      |
| `/api/memory`          | Memory CRUD                                     |
| `/api/cache`           | Cache management                                |
| `/api/usage`           | Usage statistics                                |
| `/api/keys`            | API key management                              |
| `/api/proxy-pools`     | Proxy pool config                               |
| `/api/tunnel`          | Tunnel management                               |
| `/api/settings`        | App settings                                    |
| `/api/tags`            | Tag management                                  |
| `/api/translator`      | Translator config                               |
| `/api/oauth`           | OAuth flows (Claude, Codex, Cursor, Kiro, etc.) |
| `/api/cloud/*`         | Cloudflare Worker integration                   |
| `/api/init`            | App initialization                              |
| `/api/pricing`         | Pricing data                                    |
| `/api/restart`         | Server restart (requires SHUTDOWN_SECRET)       |
| `/api/shutdown`        | Server shutdown (requires SHUTDOWN_SECRET)      |
| `/api/version`         | Version info                                    |

All mutation routes must use `parseJsonBody(request)`. All catch blocks returning client-facing JSON must use `sanitizeError(error)`.

## Middleware & Auth

| File                    | Role                                                                                                            |
| ----------------------- | --------------------------------------------------------------------------------------------------------------- |
| `src/proxy.js`          | Next.js middleware — matches dashboard routes + stateful API routes                                             |
| `src/dashboardGuard.js` | JWT verification via `jose`. Enforces auth on all matched routes. Supports JWT cookie + CLI token header bypass |

Key rules:

- `src/proxy.js` and `src/dashboardGuard.js` route matchers must stay in sync
- `/api/health` is always public
- `/api/monitoring/health` respects `requireApiKey`
- `/api/restart` and `/api/shutdown` require `SHUTDOWN_SECRET`
- Always-protected routes: `/api/shutdown`, `/api/restart`, `/api/settings/database`, `/api/settings/migrate-sqlite`

## Backend Services (`src/lib/`)

| Path                       | Purpose                                                        |
| -------------------------- | -------------------------------------------------------------- |
| `localDb.js`               | Primary database access layer (preferred entry point)          |
| `sqlite/`                  | Connection management, schema, migrations                      |
| `semanticCache.js`         | Semantic cache with memoryOwnerId-aware signatures             |
| `cacheLayer.js`            | Cache abstraction layer                                        |
| `usageDb.js`               | Usage tracking and billing data                                |
| `requestDetailsDb.js`      | Observability request-detail storage                           |
| `rateLimit/`               | Rate limiter (Redis when REDIS_URL exists, in-memory fallback) |
| `memory/`                  | Memory pipeline (injection, extraction, persistence)           |
| `tunnel/`                  | Cloudflared tunnel management                                  |
| `oauth/`                   | OAuth token refresh for Claude, Codex, Copilot, GitHub, etc.   |
| `shutdown.js`              | Graceful shutdown with queue flush                             |
| `network/`                 | Network utilities                                              |
| `security/`                | SSRF protection, URL validation                                |
| `parseJsonBody.js`         | Safe JSON body parser for mutation routes                      |
| `sanitizeError.js`         | Error sanitization for client-facing responses                 |
| `routeAuth.js`             | Route-level auth helpers                                       |
| `validateUrl.js`           | URL validation with SSRF protection                            |
| `consoleLogBuffer.js`      | Console log capture for dashboard                              |
| `modelsDevSync.js`         | models.dev catalog sync                                        |
| `disabledModelsDb.js`      | Disabled model tracking                                        |
| `providerNormalization.js` | Provider name normalization                                    |
| `initCloudSync.js`         | Cloud sync initialization                                      |
| `dataDir.js`               | Data directory resolution                                      |

## SSE Orchestration (`src/sse/`)

| Path        | Purpose                                                           |
| ----------- | ----------------------------------------------------------------- |
| `handlers/` | Chat handler: connection management, combo logic, streaming setup |
| `services/` | SSE-specific services                                             |
| `utils/`    | SSE utilities                                                     |

This layer sits between the API route and `open-sse/`. It manages the 100-connection cap, combo fallback logic, and model lock semantics before delegating to the engine.

## Shared (`src/shared/`)

| Path          | Purpose                                                                                               |
| ------------- | ----------------------------------------------------------------------------------------------------- |
| `components/` | UI component library (ConfirmModal, headers, etc.)                                                    |
| `constants/`  | Config, version (`config.js`), provider definitions (`providers.js`), model definitions (`models.js`) |
| `hooks/`      | Shared React hooks                                                                                    |
| `services/`   | Shared client-side services                                                                           |
| `utils/`      | Client-side utilities                                                                                 |

## Initialization

`src/server-init.js` is the entry point:

1. Registers global `unhandledRejection` and `uncaughtException` handlers
2. Registers shutdown hook (kills cloudflared, cleans up DNS entries)
3. Sets up signal handlers (SIGINT/SIGTERM)
4. Calls `initializeApp()` from `shared/services/initializeApp.js`

## Patterns

- **Thin API routes**: Routes call into `lib/` services; no business logic in route handlers
- **Zustand per domain**: Each domain (auth, chat, settings, providers) gets its own store
- **PWA**: `src/app/manifest.webmanifest` is the source; service worker is registration-only (no auto-updates)
- **Header actions**: Route through `headerActionStore`
