# AGENTS.md

Operational rules for AI agents working on the **Pod** project.

## Project Identity

- Project name: pod, v0.0.79
- Runtime: Bun + Next.js 16 (JS, no TS)
- Engine: open-sse/ (local fork, not npm)
- Data: SQLite at ~/.pod/pod.sqlite
- Port: 20128
- Health: GET /api/health (public)

## Non-Negotiable Rules

1. Bun only -- never npm/pnpm.
2. Product name stays "pod".
3. Never replace local open-sse with the npm package.
4. Dashboard pages at top-level; no /dashboard prefix.
5. Use ConfirmModal, never window.confirm().
6. Route header actions through headerActionStore.
7. Pair bg-primary with text-primary-fg.
8. Bump version in package.json AND src/shared/constants/config.js.
9. Use src/lib/localDb.js and src/lib/sqlite/connection.js for storage.

## Security & API Rules

1. sanitizeError(error) required in API catch blocks returning client-facing JSON.
2. Use parseJsonBody(request) for mutation routes instead of raw request.json().
3. Never return raw upstream error bodies to clients.
4. /v1/models, /v1/models/[kind], and /v1beta/models must respect requireApiKey.
5. /api/monitoring/health and /api/monitoring/health/stream respect requireApiKey; /api/health stays public.
6. /api/restart and /api/shutdown require SHUTDOWN_SECRET.
7. Stateful internal APIs must stay covered by dashboardGuard.js and src/proxy.js.
8. SSRF protection must block 0.0.0.0 and DNS-rebinding-style hosts.

## Runtime Invariants

1. SSE endpoints: 100-connection cap, 5-minute idle timeout.
2. Streaming requests remain cacheable when cache policy allows.
3. Semantic cache signatures must include memoryOwnerId.
4. SQLite cache TTL comparisons must use strftime('%Y-%m-%dT%H:%M:%SZ', 'now').
5. Connection locking must stay transactional.
6. Preserve modelLockCount_${model} semantics.
7. Keep the guarded fallback loop in src/sse/handlers/chat.js.
8. Keep the outer crash guard in open-sse/utils/stream.js.
9. Keep the guarded peek-reader behavior in open-sse/handlers/chatCore.js.

## Rate Limiting

1. Use the backend abstraction in src/lib/rateLimit/.
2. Redis selected when REDIS_URL exists; otherwise in-memory fallback.
3. Redis RPM entries must stay unique per hit.
4. If concurrent admission fails after RPM admission, release the RPM slot.
5. Backend checks must use duck typing, not constructor.name or instanceof.

## Provider Rules

1. Provider-node rename applies only to compatible/custom nodes.
2. Vertex AI request bodies must not include "stream".
3. Vercel relay timeout stays pod timeout - 5s; retry once on 502/504.
4. Keep https://www.google.com/generate_204 as relay health target.
5. Kiro retry body-gated on transient overload markers.
6. cloud/src/handlers/testClaude.js is a 410 compatibility stub.
7. Thinking block leak fix: open-sse/translator/response/claude-to-openai.js -- do NOT emit <think> or </think> as content delta.

## Operations

1. Keep global process handlers in server-init.js.
2. SIGINT must allow queue flush and cleanup.
3. Tunnel startup must treat fetchData() as non-fatal.
4. Cloudflared tunnel spawn must stay serialized.
5. Docker entrypoint must forward SIGTERM to child processes.
6. Service worker lifecycle is registration-only; Pod does not auto-update itself.
7. Offline reads use offlineJsonCache; offline writes use the mutation queue stack.
8. Queue only safe, idempotent dashboard mutations.

## Verification Before Push

```bash
bun run check
bun run test:run
bun run build
```

## Docs Map

- .agents/INDEX.md -- project index
- .agents/PRD.md -- product requirements
- .agents/architecture/* -- system design
- .agents/knowledge/* -- working knowledge
- .agents/issues/* -- historical audits
- .agents/reports/* -- release & verification reports
- DESIGN.md -- UI system reference
- CHANGELOG.md -- release history
- docs/API_INTERNAL.md -- internal API reference

## Cursor Cloud specific instructions

- Cloud agents work from the `canary` branch (base for this environment), not `main`.
- Bun is preinstalled in the VM snapshot at ~/.bun/bin; the startup update script runs `bun install` to refresh deps. Standard commands live in package.json/README (`bun run dev|build|check|test:run`).
- `bun run dev` / `bun run start` require strong non-default `JWT_SECRET` and `API_KEY_SECRET`; the runtime secret policy rejects missing/default secrets outside the build phase (`bun run build` works without them). Tests inject a deterministic fallback, so `bun run test:run` needs no env. Generate secrets with `bun -e "import { randomBytes } from 'node:crypto'; console.log(randomBytes(32).toString('hex'))"`.
- Dev server listens on port 20128. GET /api/health is public; dashboard login uses INITIAL_PASSWORD (default 123456). SQLite data is created at ~/.pod/pod.sqlite on first run.
- cloud/ (Cloudflare Worker) and tests/ have their own package.json/lockfiles and are not installed by the root `bun install`; install them separately only when working on those subprojects (root `bun run test:run` already runs the tests/ suite via the root vitest config).
