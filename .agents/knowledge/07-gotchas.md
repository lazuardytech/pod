# Gotchas

## High-Risk Regressions

1. Re-adding `/dashboard` path prefixes breaks routing.
2. Bypassing `headerActionStore` causes inconsistent page actions.
3. Using `confirm()` breaks modal UX standards.
4. Removing auth checks from model-list endpoints weakens security.
5. Changing SSE cleanup or timeout logic can reintroduce memory leaks.
6. Altering transactional connection lock flow can reintroduce race conditions.
7. Recomputing cache signature on mutated messages causes cache misses.
8. Using `datetime('now')` for cache TTL checks breaks ISO-8601 comparisons.
9. Sending `stream` in Vertex request body breaks Vertex compatibility.
10. Removing Vercel relay timeout margin causes non-deterministic timeout errors.
11. Disabling global error handlers can cause silent process death.
12. Forcing `process.exit()` on SIGINT can lose queued writes.
13. Removing SSRF blocklist (`0.0.0.0`, rebinding hosts) weakens protection.
14. Removing Codex single-reader overload peek can drop tool-call stream data.

## Offline-First Pitfalls

15. Adding offline writes without queue visibility confuses users.
16. Queueing sensitive flows (password/auth handshake) can corrupt state.
17. Skipping queue-drain retry/backoff can create sync storms.
