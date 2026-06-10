# Conventions

## Naming and Structure

- Keep the internal product name as `pod`
- Keep dashboard pages top-level
- Use local `open-sse`
- Prefer shared libraries over route-local duplication

## API Safety

- Use `sanitizeError(error)` in client-facing route errors
- Use `parseJsonBody(request)` for mutation JSON parsing
- Do not forward raw upstream response bodies to clients

## UI Rules

- Use `ConfirmModal`, not browser `confirm()`
- Use `headerActionStore` for page header actions
- Pair `bg-primary` with `text-primary-fg`

## Data Rules

- Prefer `localDb.js` and SQLite helpers
- Keep offline queue limited to safe actions
- Keep cache and lock behavior explicit
