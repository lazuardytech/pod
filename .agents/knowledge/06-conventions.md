# Conventions

## Code Style

- JavaScript only (ESM)
- `PascalCase` for components, `camelCase` for utilities
- Route folders use Next.js app-router conventions

## Platform Rules

- Use `bun` for all workflows
- Use storage facades, avoid ad-hoc DB access
- Keep top-level dashboard routes (no `/dashboard` prefix)

## UI Rules

- Use `ConfirmModal` instead of `confirm()`
- Register page header actions via `headerActionStore`
- For `bg-primary`, always use `text-primary-fg`

## API Route Error Handling (mandatory)

- Use `parseJsonBody(request)` from `@/lib/parseJsonBody.js` instead of raw `request.json()` — prevents unhandled 500 on malformed JSON.
- Destructure as `const [json, _parseErr] = await parseJsonBody(request); if (_parseErr) return _parseErr;`.
- Avoid naming destructured variable `body` when an outer `body` variable exists in scope (shadowing bug). Use `json` or `parsed`.
- Use `sanitizeError(error)` from `@/lib/sanitizeError.js` in every `catch` block that returns a response body. Never return raw `error.message`.
- Never forward upstream API response bodies to the client. Return generic status-only messages (e.g. `Failed to fetch X (HTTP 403)`).
- New `/api/*` mutation endpoints must be added to `PROTECTED_API_PATHS` in `dashboardGuard.js` and `proxy.js` matcher.

## SSE and Streaming Safety

- The chat handler `while(true)` fallback loop is guarded by `MAX_FALLBACK_ITERATIONS=50` and fully wrapped in `try/catch` with `let credentials` scoped outside the try.
- The stream `transform()` method is wrapped in `try/catch` with graceful SSE error terminator + `controller.terminate()`.
- The ChatCore peek reader uses `try/catch` on both `getReader()` and `reader.read()` — never use bare `reader.read()`.

## Rate Limiting

- Use `src/lib/rateLimit/` for all rate limiting. Backend auto-selects Redis when `REDIS_URL` is set, in-memory otherwise.
- Redis RPM uses sorted set with unique member IDs to prevent same-millisecond collisions.
- When Redis concurrent check fails after RPM passes, release the RPM slot via `backend.releaseRpm(keyId, member)`.
- Backend dispatch must use duck-type checks (`backend.releaseRpm?.(...)`) — never `constructor.name` or `instanceof`. Constructor-name checks break in minified production builds.

## PWA / Offline Rules

- Read fallback uses `offlineJsonCache`
- Safe write fallback uses mutation queue helpers
- Preserve queue visibility/status UI for users
