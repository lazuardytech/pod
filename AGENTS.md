# AGENTS.md

Operational rules for AI agents working on **Pod** (`~/projects/lt/pod`).

## Baseline

- Version: `v0.0.78`
- Package: `pod`
- Docker image: `lazuardytech/pod`
- Runtime: `bun /app/server.js`
- Data file: `~/.pod/pod.sqlite`
- Tests: `1300+` across `67` files

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
13. Runtime rate limiting (`requests_per_minute`, `concurrent_requests`) is active and must not be bypassed.

## Streaming, Cache, and Concurrency

14. SSE endpoints must use shared stream patterns, enforce connection cap (`100`), and keep idle timeout (`5m`).
15. Streaming requests are cacheable; do not block cache just because `stream: true`.
16. Semantic cache signatures must include `memoryOwnerId`; keep temperature normalization behavior.
17. SQLite cache TTL comparisons must use `strftime('%Y-%m-%dT%H:%M:%SZ', 'now')`.
18. Connection lock selection must stay transactional (`BEGIN IMMEDIATE` path in storage layer).
19. Keep `modelLockCount_${model}` semantics: increment on lock, clear on success only.

## Provider-Specific Invariants

20. Provider-node rename is custom-node-only (`openai-compatible-*`, `anthropic-compatible-*`, `custom-embedding-*`).
21. Vertex AI request body must never include `stream`.
22. Vercel relay rules are mandatory:
   - Relay timeout = pod timeout minus 5s (`x-relay-timeout`)
   - Retry once on relay `502/504`
   - Relay health test endpoint is `https://www.google.com/generate_204`
23. Kiro transient retry is body-gated (`MODEL_TEMPORARILY_UNAVAILABLE` class), not generic 500 retry.
24. Codex overloaded-stream peek must remain single-reader; keep reasoning-effort normalization (`extra-high`/`very-high` => `xhigh`).
25. Cloud worker must keep `cloud/src/handlers/testClaude.js` stub (410 response).

## Reliability and Security

26. Keep global handlers in `server-init.js`: `unhandledRejection` and `uncaughtException`.
27. SIGINT handling must allow queue flush; do not force immediate `process.exit()`.
28. Tunnel enable flow must treat `fetchData()` as non-fatal and sanitize raw browser network errors.
29. SSRF guardrails must keep blocking `0.0.0.0` and DNS-rebinding host patterns.

## PWA and Offline-First Rules

30. Keep `src/app/manifest.webmanifest` as the PWA manifest source.
31. Keep service worker lifecycle managed by `ServiceWorkerRegistrar` and `public/sw.js`.
32. Offline read path uses `src/shared/services/offlineJsonCache.js` (stale-while-revalidate behavior).
33. Offline write path uses mutation queue:
   - `src/shared/services/offlineMutationQueue.js`
   - `src/shared/services/offlineMutationRequest.js`
   - `src/shared/components/OfflineMutationProcessor.js`
34. Keep user visibility for pending offline sync via `src/shared/components/OfflineSyncStatus.js`.
35. Queue only safe idempotent dashboard settings/actions. Do not queue sensitive flows (password changes, provider auth handshakes, destructive admin operations) without explicit design.

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
