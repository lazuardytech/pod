# AGENTS.md

Operational rules for AI agents working on **Pod** (`~/projects/lt/pod`).

## Baseline

- Version: `v0.0.79`
- Package: `pod`
- Docker image: `lazuardytech/pod`
- Runtime: `bun /app/server.js`
- Data file: `~/.pod/pod.sqlite`
- Tests: `1305` across `67` files
- Health: `GET /api/health` (public, used by Docker HEALTHCHECK)

## Critical Rules

1. Use **bun only** for install, run, test, and build.
2. Keep internal naming as `pod` (package, DB, data dir, Docker image).
3. `open-sse` is local source via `jsconfig.json` alias. Never install from npm.
4. All dashboard routes are top-level. Never reintroduce `/dashboard` prefix.
5. Never use browser `confirm()`. Use `ConfirmModal`.
6. Page header actions must use `headerActionStore`.
7. For `bg-primary`, always use `text-primary-fg`.
8. Bump version in both files together: `package.json` and `src/shared/constants/config.js` (`displayVersion`).
9. Prefer `src/lib/localDb.js` and `src/lib/sqlite/connection.js` for storage operations.

## Auth, Limits, and Protection

10. Respect model-list auth rules: `/v1/models`, `/v1/models/[kind]`, `/v1beta/models` enforce API key when `requireApiKey=true`.
11. `/api/monitoring/health` and `/api/monitoring/health/stream` follow `requireApiKey`; `/api/health` stays public.
12. `/api/restart` and `/api/shutdown` require `SHUTDOWN_SECRET` auth.
13. Runtime rate limiting (`requests_per_minute`, `concurrent_requests`) is active and must not be bypassed. Redis-backed when `REDIS_URL` is set; falls back to in-memory.
14. Dashboard routes and internal APIs (`/api/cache`, `/api/models`, `/api/provider-nodes`, `/api/translator`, `/api/tunnel`) are protected via `dashboardGuard.js` middleware — any new `/api/*` route that mutates state must be added to `PROTECTED_API_PATHS` and `proxy.js` matcher.

## Error Handling and Input Safety

15. All API route handlers must use `sanitizeError(error)` from `@/lib/sanitizeError.js` in every `catch` block that returns a response body. Never return raw `error.message` or `err.message` to the client.
16. All mutation API routes must use `parseJsonBody(request)` from `@/lib/parseJsonBody.js` instead of raw `await request.json()`. Destructure as `const [json, _parseErr] = await parseJsonBody(request); if (_parseErr) return _parseErr;`. Avoid naming the destructured variable `body` when an outer `body` variable exists in scope.
17. Upstream API error bodies (raw `res.text()`, `res.json()`) must never be forwarded to the client. Return generic status-only messages (e.g. `Failed to fetch X (HTTP 403)`), not raw upstream response text.
18. Non-API internal files (`src/lib/*`, `src/shared/services/*`) may use `err.message` for logging and internal return objects consumed by callers — this is safe as long as the caller sanitizes before client exposure.

## Streaming, Cache, and Concurrency

19. SSE endpoints must use shared stream patterns, enforce connection cap (`100`), and keep idle timeout (`5m`).
20. Streaming requests are cacheable; do not block cache just because `stream: true`.
21. Semantic cache signatures must include `memoryOwnerId`; keep temperature normalization behavior.
22. SQLite cache TTL comparisons must use `strftime('%Y-%m-%dT%H:%M:%SZ', 'now')`.
23. Connection lock selection must stay transactional (`BEGIN IMMEDIATE` path in storage layer).
24. Keep `modelLockCount_${model}` semantics: increment on lock, clear on success only.

## SSE and Stream Crash Hardening

25. The chat handler `while(true)` fallback loop in `src/sse/handlers/chat.js` is guarded by `MAX_FALLBACK_ITERATIONS=50`. The entire loop body is wrapped in `try/catch` with `let credentials` scoped outside the try. Do not weaken these guards.
26. The stream `transform()` method in `open-sse/utils/stream.js` is wrapped in `try/catch` with graceful SSE error terminator + `controller.terminate()`. Never remove this outer guard.
27. The ChatCore peek reader in `open-sse/handlers/chatCore.js` has `try/catch` on both `getReader()` and `reader.read()` — with `{ value: null, done: true }` fallback. Never revert to bare `reader.read()`.

## Rate Limiting — Redis Backend

28. Rate limiting uses `src/lib/rateLimit/` with automatic backend selection: Redis via `Bun.RedisClient` when `REDIS_URL` is set, in-memory `MemoryBackend` otherwise. Never bypass the backend abstraction.
29. Redis RPM uses sorted set with unique member IDs (`${timestamp}:${uuid8}`) to avoid same-millisecond collisions. Concurrent limiter uses `INCR/DECR` with safety TTL.
30. When a Redis concurrent check fails after RPM passes, the RPM slot must be released via `backend.releaseRpm(keyId, member)`. This is built into `withApiKeyRateLimit` and `checkRateLimitByKey` — do not remove.
31. Backend dispatch must use duck-type checks (`backend.releaseRpm?.(...)`) — never `constructor.name` or `instanceof`. Constructor-name checks break in minified production builds.

## Provider-Specific Invariants

32. Provider-node rename is custom-node-only (`openai-compatible-*`, `anthropic-compatible-*`, `custom-embedding-*`).
33. Vertex AI request body must never include `stream`.
34. Vercel relay rules are mandatory:
   - Relay timeout = pod timeout minus 5s (`x-relay-timeout`)
   - Retry once on relay `502/504`
   - Relay health test endpoint is `https://www.google.com/generate_204`
35. Kiro transient retry is body-gated (`MODEL_TEMPORARILY_UNAVAILABLE` class), not generic 500 retry.
36. Codex overloaded-stream peek must remain single-reader; keep reasoning-effort normalization (`extra-high`/`very-high` => `xhigh`).
37. Cloud worker must keep `cloud/src/handlers/testClaude.js` stub (410 response).

## Reliability and Security

38. Keep global handlers in `server-init.js`: `unhandledRejection` and `uncaughtException`.
39. SIGINT handling must allow queue flush; do not force immediate `process.exit()`.
40. Tunnel enable flow must treat `fetchData()` as non-fatal and sanitize raw browser network errors.
41. SSRF guardrails must keep blocking `0.0.0.0` and DNS-rebinding host patterns.
42. Connection-level lockout uses exponential cooldown (1h, 2h, 3h...) on 401/403 from suspicious-activity or credentials-expired errors. Never bypass `markAccountUnavailable` in `src/sse/services/auth.js`.
43. Cloudflared tunnel spawn is serialized via `spawnLock` with `killExistingProcess()` — concurrent spawns must not overwrite the active process.
44. Docker entrypoint must trap SIGTERM and forward to all children (cloudflared, tailscale daemon).

## PWA and Offline-First Rules

45. Keep `src/app/manifest.webmanifest` as the PWA manifest source.
46. Keep service worker lifecycle managed by `ServiceWorkerRegistrar` and `public/sw.js`. The registrar is registration-only with no auto-update detection — Pod does not self-update.
47. Offline read path uses `src/shared/services/offlineJsonCache.js` (stale-while-revalidate behavior).
48. Offline write path uses mutation queue:
   - `src/shared/services/offlineMutationQueue.js`
   - `src/shared/services/offlineMutationRequest.js`
   - `src/shared/components/OfflineMutationProcessor.js`
49. Keep user visibility for pending offline sync via `src/shared/components/OfflineSyncStatus.js`.
50. Queue only safe idempotent dashboard settings/actions. Do not queue sensitive flows (password changes, provider auth handshakes, destructive admin operations) without explicit design.

## Verification Before Push

```bash
bun run check
bun run test:run
bun run build
```

## Docs Map

- Entry: `.agents/INDEX.md`
- Knowledge: `.agents/knowledge/*`
- Historical reports: `.agents/reports/*`
- Design system: `DESIGN.md`
