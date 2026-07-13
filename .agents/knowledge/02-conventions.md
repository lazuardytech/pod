# Conventions

## Naming

| Element           | Convention                             | Example                            |
| ----------------- | -------------------------------------- | ---------------------------------- |
| React components  | PascalCase                             | `ConfirmModal`, `SegmentedControl` |
| Utility functions | camelCase                              | `sanitizeError`, `parseJsonBody`   |
| API routes        | kebab-case                             | `/v1/chat/completions`             |
| Files             | camelCase (JS/TS), kebab-case (routes) | `localDb.ts`, `chatCore.js`        |
| Product name      | lowercase                              | "pod" (internal), "Pod" (display)  |

## Imports

- ESM only (`import`/`export`)
- `@/` alias maps to `src/`
- TypeScript throughout (src/ is TS, engine is JS)

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
- **Abort-safe body parsing**: API route handlers MUST NOT use raw `request.text()` or `request.json()` for mutation routes. Use `readBodyText(request, { maxBytes })` from `@/lib/parseJsonBody` for text bodies, and `parseJsonBody(request)` for JSON bodies. Both helpers classify aborts and return structured errors instead of throwing → caller returns 499 (client disconnect) or 413 (too large) deterministically. Hard cap defaults to 50MB, env-tunable via `POD_MAX_REQUEST_BODY_BYTES` / `POD_MAX_CHAT_BODY_BYTES`.
- **Streaming body reader**: For large body mutation requests (chat completions, embeddings, etc.), prefer `readBodyTextStream(request, { maxBytes })` from `@/lib/parseJsonBody` over `readBodyText()`. The streaming version reads in chunks, detects overflow mid-stream, and returns 413 without buffering the full body. This prevents the 9-15s stalls observed on canary with 5MB+ bodies.

## Storage

- Prefer `src/lib/localDb.ts` for all database access
- Use `src/lib/sqlite/connection.ts` only when raw SQLite is needed

## Versioning

- Bump version in both `package.json` AND `src/shared/constants/config.ts`
- Both `pkg.version` (dynamic) and `displayVersion` (static string) in config.ts

## Routes

- Dashboard pages at top-level, no `/dashboard` prefix
- `/api/health` is always public
- `/api/monitoring/health` and `/api/monitoring/health/stream` are public reads (no auth), like `/api/health`
- `/api/restart` and `/api/shutdown` require `SHUTDOWN_SECRET`

## Engine

- Local `open-sse` fork only — never npm
- After translator changes, verify thinking content does not leak into content field

## Commits

- Conventional Commits: `feat:`, `fix:`, `refactor:`, etc.
- Small, verifiable changes

## Verifying (tooling)

- Format: `oxfmt` — replaces Biome's formatter.
- Lint: `oxlint` — replaces ESLint.
- Typecheck: `tsc --noEmit` (strict mode + `noUncheckedIndexedAccess`).
- Test: `vitest` (`bun run test:run`).
- Verify gate: `bun run check` (oxfmt + oxlint + `tsc --noEmit`), then `bun run test:run`, then `bun run build` (NODE_ENV=production next build). Biome and ESLint were removed.
- Bun only — never npm/pnpm.
