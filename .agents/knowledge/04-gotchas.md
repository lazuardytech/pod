# Gotchas

## 1. Stale Documentation

Historical `.agents/issues/` files may not reflect current code. Always cross-check against live source before acting on information from those files.

## 2. Provider API Drift

Upstream provider APIs change without notice. OAuth and cookie-based providers are especially volatile. Re-verify web/cookie providers frequently.

## 3. Matcher Sync

`src/proxy.js` and `src/dashboardGuard.js` route matchers can drift apart. When adding or modifying routes, update both files. Mismatched matchers cause auth bypass or 403 errors.

## 4. Streaming Fragility

SSE code is complex with multiple nested guards. The crash guards in `open-sse/utils/stream.js` and `open-sse/handlers/chatCore.js`, and the guarded peek-reader in `chatCore.js`, must stay intact. Removing or weakening them risks process crashes.

## 5. Offline Cache Invalidation

Cache invalidation discipline is critical for correctness with offline reads. After any safe mutation, the offline JSON cache must be invalidated. Skipping this causes stale dashboard data.

## 6. Redis vs In-Memory Differences

Rate limiting and cache behave differently with Redis vs in-memory backends. Always duck-type checks (never `constructor.name` or `instanceof`) — breaks in minified builds.

## 7. Deployment Warnings

Build warnings may not fail the build. Always verify after deploy that the app starts correctly and serves requests.

## 8. Thinking Blocks

The Claude-to-OpenAI translator (`open-sse/translator/response/claude-to-openai.js`) must never emit `<thinking>` or `</thinking>` as content deltas. This causes client-side rendering bugs.

## 9. Version Drift

Version must be bumped in both `package.json` AND `src/shared/constants/config.js` (both `pkg.version` and `displayVersion`). Missing one causes inconsistent version display.

## 10. SSE Connection Cap

The 100-connection cap is enforced at the handler level. Exceeding it causes new connections to queue or reject. Monitor during high-load testing.
