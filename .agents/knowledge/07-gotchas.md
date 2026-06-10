# Gotchas

## Common Traps

1. Historical `.agents/issues/*` files may be stale.
2. Provider behavior can change without code changes in this repo.
3. `src/proxy.js` and `src/dashboardGuard.js` can drift if only one is updated.
4. Streaming code is fragile; small changes can create crash or hang regressions.
5. Offline support requires cache invalidation discipline, not only storage writes.
6. Redis and in-memory rate limiting follow different paths; test both assumptions.
7. Deployment systems may hide warnings that do not fail builds.
