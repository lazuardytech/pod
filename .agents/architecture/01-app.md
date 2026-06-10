# App Architecture

`src/` is the Next.js 16 application that wraps Pod's dashboard, API routes, and server-side orchestration.

## Major Areas

- `src/app/`: App Router pages, route handlers, manifest, landing, login, offline page
- `src/lib/`: SQLite, cache, rate limiting, memory, tunnel, auth, shutdown, networking
- `src/sse/`: server-side request handlers that bridge app routes to `open-sse`
- `src/shared/`: reusable UI, services, stores, constants, hooks, and utils
- `src/proxy.js`: middleware matcher layer
- `src/dashboardGuard.js`: dashboard and internal API protection
- `src/server-init.js`: process startup and signal handling

## Core Patterns

1. Dashboard and internal APIs are protected at both matcher and handler layers.
2. Shared services own offline reads, offline writes, and app bootstrap.
3. Route handlers should stay thin and delegate logic to `src/lib`, `src/sse`, or `open-sse`.
4. PWA behavior is explicit; Pod does not auto-update itself silently.

## Operational Notes

- Public heartbeat: `/api/health`
- Protected operational health: `/api/monitoring/health`
- Tunnel, proxy, provider, usage, cache, and memory surfaces all live in the dashboard app
