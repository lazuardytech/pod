# Conventions

## Language & Module Style

- JavaScript only (`.js`), no TypeScript
- ESM import/export
- Components: `PascalCase.js`
- Utilities: `camelCase.js`
- Next route segments: kebab-case folders
- Client-heavy page modules: `*Client.js`

## Aliases (from `jsconfig.json`)

- `@/*` → `src/*`
- `open-sse/*` → local `open-sse/*` (never npm)

## Storage Access

- Business ops: `src/lib/localDb.js`
- DB utilities: `src/lib/sqlite/connection.js`
- Don't bypass facades unless doing schema/SQL work

## Error Handling

- Public `/v1/*` endpoints: keep compatibility error shape
- Core handlers: use `open-sse/utils/error.js` helpers
- Preserve `Retry-After` on rate-limit/unavailable responses

## UI Conventions

### Design System
- Linear "Midnight Command Center" (dark only)
- CSS variables for all color tokens (see `globals.css`)
- `html.dark` class-based dark mode
- **Never use `text-white`/`text-black` with `bg-primary`** — always `text-primary-fg`

### Components
- **Button**: variants `primary|secondary|outline|ghost|danger|success`, sizes `sm|md|lg`
- **Badge**: variants `default|primary|success|warning|error|info|violet`, sizes `sm|md|lg`
- **Tabs**: `<SegmentedControl>` from `@/shared/components/SegmentedControl`, always `size="sm"`
- **Confirm dialogs**: `<ConfirmModal>` — never `window.confirm()`
- **Toasts**: `sonner` directly
- **Refresh buttons**: `size-7` square, `animate-spin` + `disabled` during refresh

### Layout
- Sidebar taxonomy: API (Endpoint, Providers, Media Providers, Combos) | Analytics (Usage, Quota) | System (Proxy Pools, Logs, Health, Settings)
- Sidebar supports collapse to icon-only mode
- All routes top-level — no `/dashboard` prefix
- Tab title separator: `✦`
- Media provider sub-routes: camelCase (`/media-providers/webSearch`), kebab-case redirects

### Header Action Slot
- Page-level actions registered via `src/store/headerActionStore.js`
- Register in `useEffect`, clean up on unmount
- Don't render page-specific actions inline in Header component

## Quality Baseline

```bash
bun run check      # pre-push lint
bun run test:run   # vitest
bun run build      # next build
```

## Production Hardening

- Rate limiting enforced at runtime (`checkRateLimitByKey`, `withApiKeyRateLimit`)
- SSE capped at 100 concurrent connections
- Connection locks use SQLite `tx()` for atomicity
- `debugLog.js` available for executor-level debug logging (dev only)
- `toolDeduper.js` deduplicates MCP tools to reduce token bloat
- Reasoning passthrough: `extractReasoningSummaryText()` + `buildReasoningSummaryCompatChunk()`
- DeepSeek V4 Pro alias: `applyDeepSeekV4ProAlias()` maps max/none aliases
- Graceful shutdown: SIGINT drains queues before exit

