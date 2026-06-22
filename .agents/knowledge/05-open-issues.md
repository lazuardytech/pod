# Open Issues & Watchlist

Current watchlist items requiring ongoing attention:

1. **Provider API drift** — Especially OAuth and cookie-based providers. Regular re-verification needed.
2. **Matcher sync** — `proxy.js` and `dashboardGuard.js` matchers must stay aligned.
3. **Relay behavior** — Cold starts, timeout races (relay timeout = pod timeout - 5s).
4. **Multi-instance readiness** — SQLite concurrent access, Redis dependency, lock semantics.
5. **Offline queue** — Only safe idempotent mutations queued; verify correctness after any store change.
6. **SSRF protection** — Must block `0.0.0.0` and DNS-rebinding hosts. Re-verify after proxy changes.
7. **Fork divergence** — Pod intentionally diverged from upstream (9Router). No safe direct merges.
