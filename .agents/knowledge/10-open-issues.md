# Open Issues and Watchlist

This is the short active watchlist. Historical audit files under `.agents/issues/*` provide context.

## Current Watchlist

1. Provider API drift, especially OAuth-like and web/cookie providers
2. Matcher drift between `src/proxy.js` and `src/dashboardGuard.js`
3. Relay behavior under cold starts and timeout races
4. Multi-instance readiness beyond the current single-instance default
5. Offline queue clarity and cache invalidation correctness
6. SSRF and network-safety regression risk across new fetch surfaces

## Working Rule

Treat historical issue docs as backlog evidence. Re-verify against live code before acting.
