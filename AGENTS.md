# AGENTS.md

Operational rules for agents working in `~/projects/lt/pod`.

## Baseline

- Project name: `pod`
- Current app version: `v0.0.79`
- Runtime: Bun + Next.js 16
- Local engine: `open-sse/` via `jsconfig.json` alias
- Primary data store: SQLite at `~/.pod/pod.sqlite`
- Public health endpoint: `GET /api/health`

## Non-Negotiable Rules

1. Use Bun for install, run, test, and build.
2. Keep the internal product name as `pod`.
3. Do not replace local `open-sse` with an npm package.
4. Keep dashboard pages top-level; do not reintroduce a `/dashboard` path prefix.
5. Use `ConfirmModal`, never browser `confirm()`.
6. Route page header actions through `headerActionStore`.
7. Pair `bg-primary` with `text-primary-fg`.
8. When bumping version, update both `package.json` and `src/shared/constants/config.js`.
9. Prefer `src/lib/localDb.js` and `src/lib/sqlite/connection.js` for storage access.

## Security and API Rules

1. `sanitizeError(error)` is required in API `catch` blocks that return client-facing JSON.
2. Use `parseJsonBody(request)` for mutation routes instead of raw `request.json()`.
3. Never return raw upstream error bodies to clients.
4. `/v1/models`, `/v1/models/[kind]`, and `/v1beta/models` must respect `requireApiKey`.
5. `/api/monitoring/health` and `/api/monitoring/health/stream` follow `requireApiKey`; `/api/health` stays public.
6. `/api/restart` and `/api/shutdown` require `SHUTDOWN_SECRET`.
7. Stateful internal APIs must stay covered by `dashboardGuard.js` and `src/proxy.js`.
8. SSRF protection must keep blocking `0.0.0.0` and DNS-rebinding-style hosts.

## Runtime Invariants

1. SSE endpoints must use shared stream patterns, a 100-connection cap, and a 5-minute idle timeout.
2. Streaming requests remain cacheable when cache policy allows them.
3. Semantic cache signatures must include `memoryOwnerId`.
4. SQLite cache TTL comparisons must use `strftime('%Y-%m-%dT%H:%M:%SZ', 'now')`.
5. Connection locking must stay transactional.
6. Preserve `modelLockCount_${model}` semantics.
7. Keep the guarded fallback loop in `src/sse/handlers/chat.js`.
8. Keep the outer crash guard in `open-sse/utils/stream.js`.
9. Keep the guarded peek-reader behavior in `open-sse/handlers/chatCore.js`.

## Rate Limiting

1. Use the backend abstraction in `src/lib/rateLimit/`.
2. Redis is selected when `REDIS_URL` exists; otherwise use in-memory fallback.
3. Redis RPM entries must stay unique per hit.
4. If concurrent admission fails after RPM admission, release the RPM slot.
5. Backend checks must use duck typing, not `constructor.name` or `instanceof`.

## Provider-Specific Rules

1. Provider-node rename applies only to compatible/custom nodes.
2. Vertex AI request bodies must not include `stream`.
3. Vercel relay timeout stays `pod timeout - 5s`.
4. Retry relay once on `502` or `504`.
5. Keep `https://www.google.com/generate_204` as the relay health target.
6. Kiro retry behavior must remain body-gated on transient overload markers.
7. Keep `cloud/src/handlers/testClaude.js` as a `410` compatibility stub.

## Operations and Offline

1. Keep global process handlers in `server-init.js`.
2. SIGINT must allow queue flush and cleanup.
3. Tunnel startup must treat `fetchData()` as non-fatal.
4. Cloudflared tunnel spawn must stay serialized.
5. Docker entrypoint must forward SIGTERM to child processes.
6. Keep `src/app/manifest.webmanifest` as the PWA manifest source.
7. Service worker lifecycle is registration-only; Pod does not auto-update itself.
8. Offline reads use `offlineJsonCache`; offline writes use the mutation queue stack.
9. Queue only safe, idempotent dashboard mutations.

## Verification Before Push

```bash
bun run check
bun run test:run
bun run build
```

## Docs Map

- Project index: `.agents/INDEX.md`
- Product summary: `.agents/PRD.md`
- Architecture notes: `.agents/architecture/*`
- Working knowledge: `.agents/knowledge/*`
- Historical issues and reports: `.agents/issues/*`, `.agents/reports/*`
- UI reference: `DESIGN.md`
