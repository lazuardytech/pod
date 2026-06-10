# Data Architecture

Pod is local-first. SQLite is the primary durable store, with additional browser-side offline storage for dashboard reads and queued writes.

## Main Stores

- SQLite: provider connections, settings, combos, model aliases, custom models, usage, request logs, cache, memory
- Browser offline storage: cached dashboard reads and safe queued mutations
- Redis: optional but important for distributed rate limiting

## Key Files

- `src/lib/sqlite/connection.js`
- `src/lib/sqlite/schema.js`
- `src/lib/localDb.js`
- `src/shared/services/offlineJsonCache.js`
- `src/shared/services/offlineMutationQueue.js`

## Current Rules

1. Prefer `localDb.js` over ad hoc SQL in route handlers.
2. Keep SQLite cache TTL logic consistent.
3. Keep lock-related writes transactional.
4. Keep offline queue limited to safe actions.
5. Treat browser cache invalidation as part of correctness, not only UX.
