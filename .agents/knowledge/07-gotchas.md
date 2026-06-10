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

## Error Handling Anti-Patterns (v0.0.79 — fixed, must not regress)

18. Returning raw `error.message` in API responses — use `sanitizeError(error)` in every catch block.
19. Using raw `request.json()` without try/catch — use `parseJsonBody(request)`.
20. Forwarding upstream API response bodies to client — return generic status-only messages.
21. Shadowing outer `let body` with inner `const [body, _parseErr]` — use `json` or `parsed` as destructured name.
22. Inserting new imports into the middle of multiline import blocks — add after the closing `}` line.
23. Using `log?.error` in file-level scope of `open-sse/utils/stream.js` — `log` is not defined there; use `console.error`.
24. Using `credentials?.connectionId` in catch block where `credentials` is `const`-scoped inside try — hoist to `let` above try.

## SSE Crash Anti-Patterns (v0.0.79 — fixed, must not regress)

25. Removing `MAX_FALLBACK_ITERATIONS` guard from chat handler `while(true)` loop.
26. Removing `try/catch` wrapper from stream `transform()` or `flush()` methods.
27. Removing `try/catch` from ChatCore peek `getReader()` or `reader.read()`.

## Rate Limiting Anti-Patterns (v0.0.79 — fixed, must not regress)

28. RPM slot leak when concurrent check fails after RPM passes — release slot via `backend.releaseRpm()`.
29. Sorted set member collision at same millisecond — use unique member IDs (`${timestamp}:${uuid8}`).
30. Missing `INCR/DECR` safety TTL on concurrent key — add expire to prevent stale counters.
31. Blind `memoryCache.clear()` in `semanticCache.invalidateByModel` — use targeted eviction via `forEach()`.
32. `createMemory()` without transaction wrapping — use `tx()` for SELECT-then-INSERT/UPDATE.
33. `createProviderConnection()` without transaction — concurrent upserts produce duplicates.
34. Missing auth on `/api/cache`, `/api/models`, `/api/provider-nodes`, `/api/translator`, `/api/tunnel` — all now in `PROTECTED_API_PATHS` + `proxy.js` matcher.
35. Cloudflared process overwritten on concurrent spawn — serialized via `spawnLock` with `killExistingProcess()`.
36. Docker entrypoint ignored tailscaled on SIGTERM — trap forwards signal to all children.
37. `concurrentCounters` map grew unbounded — periodic trim via `lastAccess` tracking.

## Production-Build Anti-Patterns (v0.0.79 — fixed, must not regress)

38. Using `constructor.name` or `instanceof` for backend dispatch — breaks in minified production builds. Use duck-type checks (`backend.releaseRpm?.(...)`).
