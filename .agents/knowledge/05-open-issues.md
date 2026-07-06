# Open Issues & Watchlist

## Active Items

| #   | Issue                         | Risk   | Notes                                                                                                |
| --- | ----------------------------- | ------ | ---------------------------------------------------------------------------------------------------- |
| 1   | **Provider API drift**        | High   | OAuth and cookie-based providers change frequently. Regular re-verification needed.                  |
| 2   | **Matcher sync**              | Medium | `src/proxy.js` and `src/dashboardGuard.js` matchers must stay aligned.                               |
| 3   | **Relay behavior**            | Medium | Cold starts, timeout races (relay timeout = pod timeout - 5s). First request after idle may be slow. |
| 4   | **Multi-instance readiness**  | Low    | SQLite concurrent access, Redis dependency, lock semantics. Current design is single-instance.       |
| 5   | **Offline queue correctness** | Medium | Only safe idempotent mutations queued. Verify correctness after any store change.                    |
| 6   | **SSRF protection**           | Medium | Must block `0.0.0.0` and DNS-rebinding hosts. Re-verify after proxy changes.                         |
| 7   | **Fork divergence**           | Low    | Pod intentionally diverged from upstream (9Router). No safe direct merges.                           |

## Historical Context

- Security hardening phases (v0.0.77-v0.0.79) addressed sanitizeError, parseJsonBody, upstream leak cleanup, SSE crash hardening
- Memory leak fix (v0.0.13) reduced RSS from 1.2GB to 200-400MB
- Cache hit rate fixes (v0.0.19-v0.0.22) resolved temperature normalization and memory injection signature mismatches
- CodeQL alerts (v0.0.18-v0.0.51) were systematically resolved

See `CHANGELOG.md` for full history. See `.agents/issues/` for historical audit files (verify against live code).
