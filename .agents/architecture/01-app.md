# App Architecture (src/)

## Structure

```
src/
  app/            Next.js App Router pages and API routes
  lib/            Backend services
  sse/            SSE chat orchestration layer
  shared/         UI components, stores, constants, utils
  proxy.js        Next.js middleware
  dashboardGuard.js  Auth guard middleware
  server-init.js  App initialization and signal handlers
```

### src/app/

- **Pages**: dashboard (top-level, no `/dashboard` prefix), login, landing, offline
- **API routes**: `/api/health` (public), `/api/monitoring/health` (requires API key), proxy endpoints for model inference
- All API mutation routes use `parseJsonBody(request)` instead of `raw request.json()`
- API catch blocks use `sanitizeError(error)` before returning client-facing JSON

### src/lib/

- `localDb.js` — Primary database access layer (preferred entry point)
- `sqlite/connection.js` — Low-level SQLite connection management
- `sqlite/schema.js` — Schema definitions and migrations
- `cache/` — Semantic cache, prompt cache, offline JSON cache
- `rateLimit/` — Rate limiter (Redis backed when `REDIS_URL` exists, in-memory fallback)
- `memory/` — Memory/persistence layer
- `tunnel/` — Cloudflared tunnel management
- `auth/` — Authentication and session handling
- `shutdown/` — Graceful shutdown logic

### src/sse/

SSE chat handler — the orchestration layer that sits between the API route and `open-sse/`. Handles connection management, combo model logic, and streaming setup before delegating to the engine.

### src/shared/

- **Components**: UI component library (ConfirmModal, headers, etc.)
- **Stores**: Zustand stores per domain (auth, chat, settings, etc.)
- **Constants**: Config values, including version in `constants/config.js`
- **Utils**: Shared helpers, validation, formatting

### Patterns

- **Thin API routes**: Routes call into `lib/` services; no business logic directly in route handlers.
- **Shared services via lib/**: All backend logic lives in `src/lib/` or `src/sse/`.
- **Zustand per domain**: Each domain (auth, chat, settings, providers) gets its own store for focused state management.
- **PWA**: `src/app/manifest.webmanifest` as the source, service worker is registration-only (no auto-updates).
- **Middlewares**: `src/proxy.js` (Next.js middleware) matches dashboard routes; `src/dashboardGuard.js` enforces auth.
