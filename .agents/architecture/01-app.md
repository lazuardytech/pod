# App Architecture — Next.js

The `src/` directory is the Next.js 16 application: dashboard UI, API routes, SSE handlers, and backend services.

## Directory Map

```
src/
├── app/                        # Next.js App Router
│   ├── layout.js               # Root layout: fonts, ThemeProvider, PWA, ServiceWorker
│   ├── page.js                 # → /endpoint redirect
│   ├── globals.css             # Tailwind v4 + Linear design tokens
│   ├── manifest.webmanifest    # PWA manifest
│   ├── (dashboard)/            # Dashboard route group (20+ pages)
│   ├── api/                    # API route handlers (80+ endpoints)
│   ├── landing/                # Public landing page
│   ├── login/                  # Login page
│   ├── callback/               # OAuth callback handler
│   └── offline/                # Offline fallback page
├── lib/                        # Server-side libraries
│   ├── localDb.js              # SQLite query facade (35+ consumers)
│   ├── sqlite/                 # connection.js, schema.js, migrate-from-json.js
│   ├── rateLimit/              # index.js, backend.js, redis.js, memory.js
│   ├── memory/                 # store, extraction, retrieval, injection, settings
│   ├── tunnel/                 # cloudflared.js, tailscale.js, tunnelManager, state
│   ├── network/                # outboundProxy, connectionProxy, initOutboundProxy
│   ├── oauth/                  # Provider OAuth integrations
│   ├── cacheLayer.js           # Semantic cache layer
│   └── shutdown.js             # Graceful shutdown orchestrator
├── sse/                        # SSE handlers (server-side credential/auth layer)
│   ├── handlers/               # chat, embeddings, image, stt, tts, search, fetch
│   └── services/               # auth (credentials), model, tokenRefresh
├── shared/                     # Shared between server + client
│   ├── components/             # 46+ React components (design system + features)
│   ├── services/               # initializeApp, offlineJsonCache, offlineMutationQueue
│   ├── stores/                 # 6 Zustand stores (provider, theme, user, etc.)
│   ├── constants/              # config, models, providers, pricing, colors
│   ├── hooks/                  # useCopyToClipboard, useTheme
│   └── utils/                  # machineId, api, cn, clineAuth, etc.
├── proxy.js                    # Next.js edge middleware (auth guard)
├── dashboardGuard.js           # Dashboard route protection + JWT validation
└── server-init.js              # Entry point: signal handlers, startup sequence
```

## Entry Point Flow

```
server-init.js
  │
  ├─ Register unhandledRejection handler
  ├─ Register uncaughtException handler
  ├─ Register SIGINT handler (queue flush, no force exit)
  ├─ Register SIGTERM handler (tunnel cleanup)
  │
  └─ Call initializeApp()                  ← shared/services/initializeApp.js
       │
       ├─ Init SQLite schema
       ├─ Migrate from JSON (first boot)
       ├─ Init rate limit backend (Redis or memory)
       ├─ Init outbound proxy settings
       ├─ Init tunnels (restore saved state)
       ├─ Schedule model pricing sync
       └─ Start cloud sync scheduler
```

## Dashboard Pages (20+)

| Route | Purpose |
|-------|---------|
| `/endpoint` | Main endpoint management (base URL, API key display) |
| `/providers` | Provider connections list |
| `/providers/new` | Add new provider |
| `/providers/[id]` | Provider detail: connections, models, cooldown |
| `/combos` | Model fallback chain management |
| `/memory` | Conversational memory browser |
| `/cache` | Semantic cache browser |
| `/usage` | Usage analytics: charts, tables, topology, quotas |
| `/health` | System telemetry, account lockout status |
| `/proxy-pools` | Outbound proxy management |
| `/logs` | Request logs, console output |
| `/settings` | General settings (thinking, memory, cache) |
| `/settings/pricing` | Pricing settings |
| `/translator` | Format translator with test console |
| `/basic-chat` | Built-in chat playground |
| `/media-providers/[kind]` | Per-media-kind providers |
| `/landing` | Marketing landing page |
| `/login` | Password login |
| `/callback` | OAuth callback handler |

## API Route Hierarchy

### Core AI Proxy (v1)
- `/v1/chat/completions` — Main chat (withApiKeyRateLimit)
- `/v1/embeddings`, `/v1/images/generations`, `/v1/audio/speech`, `/v1/audio/transcriptions`
- `/v1/search`, `/v1/web/fetch`
- `/v1/messages`, `/v1/messages/count_tokens` — Anthropic format
- `/v1/responses` — OpenAI Responses API
- `/v1/models`, `/v1/models/[kind]` — Model listing
- `/v1beta/models` — Gemini format

### Providers
- CRUD: `/api/providers`, `/api/providers/[id]`
- Test: `/api/providers/[id]/test`, `/api/providers/[id]/test-models`
- Validate: `/api/providers/validate`
- Client-safe list: `/api/providers/client`
- Suggested models: `/api/providers/suggested-models`
- Provider nodes: `/api/provider-nodes` (CRUD, rename, clear-lock, validate)

### Auth & Keys
- `/api/keys` — API key CRUD + rate limit config
- `/api/auth/login`, `/api/auth/logout` — Password → JWT
- `/api/oauth/[provider]/[action]` — Generic OAuth
- `/api/oauth/cursor/import`, `/api/oauth/cursor/auto-import`
- `/api/oauth/kiro/import`, `/api/oauth/kiro/auto-import`
- `/api/oauth/kiro/social-exchange`, `.../social-authorize`
- `/api/oauth/iflow/cookie`, `/api/oauth/gitlab/pat`

### Settings
- `/api/settings` — Read/update general settings
- `/api/settings/require-login`, `/api/settings/cache-config`
- `/api/settings/database` — Export/backup
- `/api/settings/memory`, `/api/settings/migrate-sqlite`
- `/api/settings/proxy-test`

### Monitoring
- `/api/health` — Public heartbeat
- `/api/monitoring/health` — Full health (protected)
- `/api/monitoring/health/stream` — SSE health stream
- `/api/usage/stats`, `/api/usage/stream`, `/api/usage/logs`
- `/api/usage/chart`, `/api/usage/history`
- `/api/usage/request-logs`, `/api/usage/request-logs/stream`
- `/api/usage/provider-limits/stream`

## SSE Handler Architecture

```
src/sse/handlers/chat.js              ← Server-side credential layer
  │
  ├─ Parse body, extract API key
  ├─ Enforce rate limit (if API key present)
  ├─ Resolve combo (fallback/round-robin)
  ├─ Resolve model alias (openai/anthro-compatible nodes, custom embedding)
  │
  └─ Credential fallback loop
       ├─ getProviderCredentials()      ← src/sse/services/auth.js
       │    ├─ Resolve provider aliases
       │    ├─ Filter locked accounts (connection + model level)
       │    ├─ Round-robin / fill-first strategy
       │    └─ Cache connections (1s TTL)
       │
       └─ handleChatCore()              ← open-sse/handlers/chatCore.js
            (Engine pipeline — see 00-engine.md)
```

### Credential Management (`src/sse/services/auth.js`)
- `getProviderCredentials`: Resolves provider, filters locked accounts, applies strategy
- `markAccountUnavailable`: Locks connection (exponential) or model (minimum lockout)
- `clearAccountError`: Clears locks on success
- Connection-level lockout: 1h, 2h, 3h... on 401/403
- Model locks: `modelLockCount_${model}` incremental

### Token Refresh (`src/sse/services/tokenRefresh.js`)
- Re-exports provider-specific refresh functions
- `checkAndRefreshToken`: Proactive refresh with in-flight dedup
- `updateProviderCredentials`: Persists refreshed tokens to SQLite

## Component Architecture

### Design System (shared/components/)
- `Button.js` — 5 variants (primary, secondary, ghost, danger, outline), 3 sizes
- `Card.js` — 3 variants (default, elevated, nested)
- `Input.js` — Transparent + Gunmetal fill, 6px radius, Neon Lime focus
- `Badge.js` — Gunmetal bg, Storm Cloud text, 4px radius
- `Modal.js`, `ConfirmModal.js`, `Drawer.js` — Overlay primitives
- `Select.js`, `Toggle.js`, `SegmentedControl.js` — Form controls
- `Tooltip.js`, `Loading.js`, `Pagination.js` — Utilities

### Layout
- `DashboardLayout.js` — Sidebar + Header + Content with nested surface hierarchy
- `AuthLayout.js` — Centered auth pages
- `Sidebar.js` — Compact nav items, Neon Lime active state, 2px radius
- `Header.js` — Header with action buttons via `headerActionStore`

### Stores (Zustand)
| Store | Purpose |
|-------|---------|
| `providerStore.js` | Provider connection state |
| `themeStore.js` | Theme preference (dark-only in practice) |
| `userStore.js` | Auth user state |
| `notificationStore.js` | Toast notifications |
| `headerActionStore.js` | Page header action buttons |
| `headerSearchStore.js` | Header search state |
