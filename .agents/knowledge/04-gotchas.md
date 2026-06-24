# Gotchas

1. **Stale issues** — Historical `.agents/issues/` files may not reflect current code. Always cross-check.
2. **Provider drift** — Upstream provider behavior changes without code changes. Re-verify web/cookie providers frequently.
3. **Matcher drift** — `proxy.js` and `dashboardGuard.js` route matchers can drift apart. Keep in sync.
4. **Streaming fragility** — SSE code is complex; guard loops and peek-readers must stay intact.
5. **Offline cache** — Cache invalidation discipline is critical for correctness with offline reads.
6. **Redis vs in-memory** — Rate limiting and cache behave differently. Duck-type checks, not `instanceof`.
7. **Deployment warnings** — May not fail builds. Always verify after deploy.
8. **Thinking blocks** — `claude-to-openai.js` must never emit `<think>`/`</think>` in content delta.
