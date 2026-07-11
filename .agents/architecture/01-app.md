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
  instrumentation.ts  Next.js 16 entry point (initializeApp + signal handlers)
  server-init.ts      App initialization and global signal handlers
```

## Dashboard Pages

All 15 dashboard pages are top-level — no `/dashboard` prefix.

| Page            | Route               |
| --------------- | ------------------- |
| Endpoint        | `/endpoint`         |
| LLM Providers   | `/providers`        |
| Media Providers | `/media-providers`  |
| Combos          | `/combos`           |
| Quota           | `/quota`            |
| Usage           | `/usage`            |
| Memory          | `/memory`           |
| Cache           | `/cache`            |
| Health          | `/health`           |
| Logs            | `/logs`             |
| Proxy Pools     | `/proxy-pools`      |
| Settings        | `/settings`         |
| Translator      | `/translator`       |
| Basic Chat      | `/basic-chat`       |
| Pricing         | `/settings/pricing` |

## API Routes (26 groups)

| Route group            | Purpose                                                             |
| ---------------------- | ------------------------------------------------------------------- |
| `/v1/*`                | OpenAI-compatible inference endpoints                               |
| `/v1beta/*`            | Gemini-compatible endpoints                                         |
| `/api/auth`            | Dashboard authentication                                            |
| `/api/health`          | Public health check                                                 |
| `/api/monitoring/*`    | Monitoring health (API key required)                                |
| `/api/providers`       | Provider CRUD                                                       |
| `/api/provider-nodes`  | Custom node management                                              |
| `/api/media-providers` | Media provider management                                           |
| `/api/combos`          | Combo CRUD                                                          |
| `/api/memory`          | Memory CRUD                                                         |
| `/api/cache`           | Cache management                                                    |
| `/api/usage`           | Usage statistics                                                    |
| `/api/keys`            | API key management                                                  |
| `/api/proxy-pools`     | Proxy pool config (http + Vercel relay pools, outbound SOCKS pools) |
| `/api/tunnel`          | Tunnel management                                                   |
| `/api/settings`        | App settings                                                        |
| `/api/tags`            | Tag management                                                      |
| `/api/translator`      | Translator config                                                   |
| `/api/oauth`           | OAuth flows (Claude, Codex, Cursor, Kiro, etc.)                     |
| `/api/cloud/*`         | Cloudflare Worker integration                                       |
| `/api/init`            | App initialization                                                  |
| `/api/pricing`         | Pricing data                                                        |
| `/api/restart`         | Server restart (requires SHUTDOWN_SECRET)                           |
| `/api/shutdown`        | Server shutdown (requires SHUTDOWN_SECRET)                          |
| `/api/version`         | Version info                                                        |

All mutation routes must use `parseJsonBody(request)`. All catch blocks returning client-facing JSON must use `sanitizeError(error)`.

## Auth

Internal API routes self-authenticate via `routeAuth.ts`. There is no Next.js middleware — `proxy.ts` and `dashboardGuard.ts` have been removed. Auth rules:

- `/api/health` is always public
- `/api/monitoring/health` respects `requireApiKey`
- `/api/restart` and `/api/shutdown` require `SHUTDOWN_SECRET`
- `/v1/*` routes enforce API key auth when `requireApiKey` is enabled

## Backend Services (`src/lib/`)

| Path                       | Purpose                                                               |
| -------------------------- | --------------------------------------------------------------------- |
| `localDb.ts`               | Primary database access layer (preferred entry point)                 |
| `sqlite/`                  | Connection management, schema                                         |
| `semanticCache.ts`         | Semantic cache with memoryOwnerId-aware signatures                    |
| `cacheLayer.ts`            | Cache abstraction layer                                               |
| `usageDb.ts`               | Usage tracking and billing data                                       |
| `requestDetailsDb.ts`      | Observability request-detail storage                                  |
| `rateLimit/`               | Rate limiter (Redis when REDIS_URL exists, in-memory fallback)        |
| `memory/`                  | Memory pipeline (injection, extraction, persistence)                  |
| `tunnel/`                  | Cloudflared tunnel management                                         |
| `oauth/`                   | OAuth token refresh for Claude, Codex, Copilot, GitHub, etc.          |
| `shutdown.ts`              | Graceful shutdown with queue flush                                    |
| `network/`                 | Network utilities (connection proxy resolution: pool → legacy → none) |
| `security/`                | Runtime secrets validation                                            |
| `parseJsonBody.ts`         | Safe JSON body parser for mutation routes                             |
| `sanitizeError.ts`         | Error sanitization for client-facing responses                        |
| `routeAuth.ts`             | Internal API self-authentication                                      |
| `validateUrl.ts`           | URL validation with SSRF protection                                   |
| `consoleLogBuffer.ts`      | Console log capture for dashboard                                     |
| `modelsDevSync.ts`         | models.dev catalog sync                                               |
| `disabledModelsDb.ts`      | Disabled model tracking                                               |
| `providerNormalization.ts` | Provider name normalization                                           |
| `initCloudSync.ts`         | Cloud sync initialization                                             |
| `dataDir.ts`               | Data directory resolution                                             |

## SSE Orchestration (`src/sse/`)

| Path        | Purpose                                                           |
| ----------- | ----------------------------------------------------------------- |
| `handlers/` | Chat handler: connection management, combo logic, streaming setup |
| `services/` | SSE-specific services (model resolution, auth, token refresh)     |
| `utils/`    | SSE logger                                                        |

This layer sits between the API route and `open-sse/`. It manages the 100-connection cap, combo fallback logic, and model lock semantics before delegating to the engine.

## Shared (`src/shared/`)

| Path          | Purpose                                                                                               |
| ------------- | ----------------------------------------------------------------------------------------------------- |
| `components/` | UI component library (ConfirmModal, headers, etc.)                                                    |
| `constants/`  | Config, version (`config.ts`), provider definitions (`providers.ts`), model definitions (`models.ts`) |
| `hooks/`      | Shared React hooks                                                                                    |
| `services/`   | Shared client-side services (offline cache, cloud sync)                                               |
| `utils/`      | Client-side utilities                                                                                 |

## Initialization

`src/instrumentation.ts` is the canonical startup path (Next.js 16):

1. Calls `initializeApp()` at cold start in production
2. Registers global `unhandledRejection` and `uncaughtException` handlers
3. Sets up signal handlers (SIGINT/SIGTERM) with queue flush and cleanup

## Patterns

- **Thin API routes**: Routes call into `lib/` services; no business logic in route handlers
- **Zustand per domain**: Each domain (auth, providers, theme, notifications, header) gets its own store
- **PWA**: Service worker is registration-only (no auto-updates); offline reads via `offlineJsonCache`; writes queue via mutation stack
- **Header actions**: Route through `headerActionStore`
