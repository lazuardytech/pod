# Conventions

## Naming

| Element | Convention | Example |
|---------|-----------|---------|
| React components | PascalCase | `ConfirmModal`, `SegmentedControl` |
| Utility functions | camelCase | `sanitizeError`, `parseJsonBody` |
| API routes | kebab-case | `/v1/chat/completions` |
| Files | camelCase (JS), kebab-case (routes) | `localDb.js`, `chatCore.js` |
| Product name | lowercase | "pod" (internal), "Pod" (display) |

## Imports

- ESM only (`import`/`export`)
- `@/` alias maps to `src/`
- No TypeScript

## Components

- Always use `ConfirmModal`, never `window.confirm()`
- Pair `bg-primary` with `text-primary-fg`
- Route header actions through `headerActionStore`
- Use `sonner` for toasts (position bottom-right)
- Use `SegmentedControl` for pill tabs

## API Safety

- `sanitizeError(error)` required in all catch blocks returning client-facing JSON
- `parseJsonBody(request)` for all mutation routes (never raw `request.json()`)
- Never return raw upstream error bodies to clients
- SSRF protection must block `0.0.0.0` and DNS-rebinding-style hosts

## Storage

- Prefer `src/lib/localDb.js` for all database access
- Use `src/lib/sqlite/connection.js` only when raw SQLite is needed

## Versioning

- Bump version in both `package.json` AND `src/shared/constants/config.js`
- Both `pkg.version` (dynamic) and `displayVersion` (static string) in config.js

## Routes

- Dashboard pages at top-level, no `/dashboard` prefix
- `/api/health` is always public
- `/api/monitoring/health` respects `requireApiKey`
- `/api/restart` and `/api/shutdown` require `SHUTDOWN_SECRET`

## Engine

- Local `open-sse` fork only — never npm
- After translator changes, verify thinking content does not leak into content field

## Commits

- Conventional Commits: `feat:`, `fix:`, `refactor:`, etc.
- Small, verifiable changes
