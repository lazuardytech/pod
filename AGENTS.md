# AGENTS.md

Operational rules for AI agents working on the **Pod** project.

## Learned User Preferences

- Uses `/ponytail lite|full|ultra` heavily (default full; `ultra` = delete-before-add, challenge scope). "stop ponytail" / "normal mode" reverts. Leverages parallel subagents for multi-phase work (explore → audit → plan → build → verify).
- Communicates operational/planning requests in Indonesian; expects concise, no-essay responses for routine ops, full detail when explicitly asked for a report/walkthrough.
- Wants zero leftover uncommitted changes — after substantive work, commit and push ALL uncommitted changes to `origin canary` so nothing drifts. Never leave changes unpushed.
- Before any Zeabur deploy, user expects all env vars on every service (pod/pod-canary) verified complete and valid to avoid build/runtime failures.
- Prefers docs kept concise and structured in English; wants `.agents/INDEX.md` as a clean, accurate map of all docs and AGENTS/.agents refreshed together after repo changes.

## Learned Workspace Facts

- `/api/monitoring/health` + `/api/monitoring/health/stream` are PUBLIC reads (auth guard removed, `src/app/api/monitoring/health/_auth.tsx` deleted) — consistent with `/api/health`. Health dashboard `/health` fetches them unauthenticated; the old 401 caused the "Network unavailable. Showing cached health snapshot." toast on prod.
- `changelogUrl` in `src/shared/constants/config.ts` uses `refs/heads/canary` (never `master` — dead branch 404s).
- `src/app/api/proxy-pools/vercel-deploy/route.ts` trailing-slash trim uses a real `/\\/$/` regex (an earlier `/\\\\/$/` matched a backslash, producing `//<relayPath>`).
- Rate-limit env: `RATELIMIT_KEY_PREFIX` (Redis namespace isolation) and `RATELIMIT_REDIS_TIMEOUT_MS` (default 1000) — must appear in README env table.
- `.gitignore` ignores agent-tool dirs: `.codegraph`, `.astro`, `.mimocode`, `.opencode`, `mastracode`, `.rwx` (plus `.cursor`, `.commandcode`, `.pi`, `.claude`); do not commit those dirs.
- open-sse/ has 19 provider executors (base.js is the base class, index.js is the barrel) — not "20". `src/lib/` holds router/translators; executors/translators live frozen in the `open-sse/` JS fork.
- Path dirs with parentheses (e.g. `src/app/(dashboard)/`) break naive `sed 's/([0-9].*//'` patterns — use a paren-aware pattern when parsing `tsc` output.
- Chrome `ERR_FAILED` interstitial after idle (fixed by hard reload) is often SW-side: `public/sw.js` must keep network-first navigation, never reject `respondWith`, and avoid `Response.error()` (esp. images); `ServiceWorkerRegistrar` must not blind `location.reload()` on every `controllerchange`. RSC/`?_rsc=` fetches are not SW-intercepted (idle CF/TLS is a separate failure mode).

## Project Identity

- **Project name**: pod, v0.0.82
- **Runtime**: Bun + Next.js 16 (TS, strict mode)
- **Engine**: open-sse/ (local fork, not npm, frozen as JS)
- **Data**: SQLite at ~/.pod/pod.sqlite
- **Port**: 20128
- **Health**: GET /api/health (public)
- **Deployment**: pod.lazuardy.tech (Zeabur, Cloudflare-proxied)
- **Branch model**: canary (active dev), main (stable/release)

## Non-Negotiable Rules

1. Bun only — never npm/pnpm.
2. Product name stays "pod".
3. Never replace local open-sse with the npm package.
4. Dashboard pages at top-level; no /dashboard prefix.
5. Use ConfirmModal, never window.confirm().
6. Route header actions through headerActionStore.
7. Pair bg-primary with text-primary-fg.
8. Bump version in package.json AND src/shared/constants/config.ts (displayVersion).
9. Use src/lib/localDb.ts and src/lib/sqlite/connection.ts for storage.
10. User may invoke `/ponytail lite|full|ultra`; "stop ponytail" / "normal mode" reverts. Ponytail favors one-line solutions, YAGNI, stdlib over deps, and deletion over addition.

## Security & API Rules

1. sanitizeError(error) required in API catch blocks returning client-facing JSON.
2. Use parseJsonBody(request) for mutation routes instead of raw request.json().
   Note: parseJsonBody throws on empty bodies (e.g. POST with no body). Routes accepting optional/no body should read via request.text() + guard instead.
   Note: For large bodies, use `readBodyTextStream()` from `@/lib/parseJsonBody` instead — reads chunk-by-chunk with size cap, prevents stalls.
3. Never return raw upstream error bodies to clients.
4. /v1/models, /v1/models/{model}, and /v1beta/models must respect requireApiKey.
5. /api/monitoring/health and /api/monitoring/health/stream are public reads (no auth), like /api/health. /api/health stays public.
6. /api/restart and /api/shutdown require SHUTDOWN_SECRET; return 403 in production (NODE_ENV=production).
7. validateStartupSecrets throws in production if API_KEY_SECRET or JWT_SECRET is missing/default.
8. Stateful internal APIs self-authenticate via routeAuth.ts — dashboardGuard.ts and proxy.ts were removed (no middleware.ts registered).
9. SSRF protection must block 0.0.0.0 and DNS-rebinding-style hosts.
10. All src/ is TypeScript with strict: true + noUncheckedIndexedAccess in tsconfig.
11. cloud/ has its own tsconfig.json with @cloudflare/workers-types.
12. Body size cap defaults to 50MB (env `POD_MAX_REQUEST_BODY_BYTES`); chat routes use `POD_MAX_CHAT_BODY_BYTES` (default inherits). Helpers `readBodyText()` (in `src/lib/parseJsonBody.ts`), `readBodyTextStream()` (in `@/lib/parseJsonBody`), and `getMaxRequestBodyBytes(stream)` (in `src/shared/constants/config.ts`) are the canonical entry points — raw `request.text()` / `request.json()` for mutation routes is forbidden.

## Runtime Invariants

1. SSE endpoints: 100-connection cap, 5-minute idle timeout. Note: Node.js HTTP body parser can cause 9-15s stalls on `curl/8.x` User-Agent for bodies > 1MB. Mitigated via `readBodyTextStream()` in v0.0.82.
2. Streaming requests remain cacheable when cache policy allows.
3. Semantic cache signatures must include memoryOwnerId.
4. SQLite cache TTL comparisons must use strftime('%Y-%m-%dT%H:%M:%SZ', 'now').
5. Connection locking must stay transactional.
6. Preserve modelLockCount\_${model} semantics.
7. Keep the guarded fallback loop in src/sse/handlers/chat.ts.
8. Keep the outer crash guard in open-sse/utils/stream.js.
9. Keep the guarded peek-reader behavior in open-sse/handlers/chatCore.js.
10. open-sse/ is frozen as JS — do NOT convert open-sse/ source files. Type surface via src/sse/open-sse.d.ts.
11. Regex literals with flags that look unterminated to Turbopack must use `new RegExp()` — apply in any file where Turbopack fails to parse a regex literal.
12. `src/instrumentation.ts` is the canonical startup path (Next.js 16) — runs `initializeApp()` + signal handlers in production; side-effect imports in layout.tsx for startup code have been removed.
13. AbortError at `node:_http_server` (client disconnect) must be classified as `[ClientDisconnect]`, not `[FATAL]`. SSE stream wrappers use `controller.close()` (not `controller.error(err)`) on reader abort. See `.agents/knowledge/04-gotchas.md` item 31.
14. `open-sse/` and `cloud/` are excluded from `tsc` (tsconfig `exclude`). Do NOT consume symbols exported from `open-sse/` in `src/` — tsc will not see them and the production build fails. Keep cross-boundary constants inlined in `src/` (e.g. rate-limit header constants in `src/lib/rateLimit/index.ts`).
15. `next.config.mjs` `serverExternalPackages` must include `undici` (and `bun:sqlite`). undici v8 throws a bare `Error` when Turbopack bundles its top-level code into the standalone server chunk, breaking dynamic `import("undici")` in server routes (`src/app/api/proxy-pools/[id]/test/route.ts`) and `src/lib/network/`. Keep undici external (loaded from `node_modules` at runtime) — never bundle it.

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
6. cloud/src/handlers/testClaude.ts is a 410 compatibility stub.
7. Thinking block leak fix: open-sse/translator/response/claude-to-openai.js — do NOT emit `<think>` or `</think>` as content delta.

## Operations

1. Keep global process handlers in server-init.ts and instrumentation.ts (production).
2. SIGINT must allow queue flush and cleanup.
3. Tunnel startup must treat fetchData() as non-fatal.
4. Cloudflared tunnel spawn must stay serialized.
5. Docker entrypoint must forward SIGTERM to child processes.
6. Service worker lifecycle is registration-only (no auto-update UX). Keep network-first navigation in `public/sw.js`; never reject `respondWith` / never `Response.error()` on images; do not blind `location.reload()` on `controllerchange`.
7. Offline reads use offlineJsonCache; offline writes use the mutation queue stack.
8. Queue only safe, idempotent dashboard mutations.
9. Git workflow: canary is active development branch; main is stable/release branch.
10. PR convention: canary→main via PR only — never push canary changes directly to origin/main.
11. Zeabur env changes take effect only on next restart/deploy — no auto-restart on env mutation.
12. After any push to canary, verify deployment on Zeabur (build logs, `/api/health`, version endpoint) before considering the task complete.
13. After PR merge to main, sync canary branch by resetting to main — both branches must remain at the same commit.
14. Keep canary and prod Zeabur env settings (auth/requireApiKey, body caps, rate limits, secrets) identical to avoid behavioral drift. Each service has its own SQLite volume — auth state and requireApiKey must be configured per-service.

## Deployment Topology (Zeabur)

- Project: `Pod`, env `production` (id `6a1b7fa2b764eebf4f53b39e`), region Lazuardy Tech.
- Service `pod` (main, id `6a1b7ffff9a5b4afba15bc03`) -> `pod.lazuardy.tech` (Cloudflare-proxied), port 20140.
- Service `pod-canary` (id `6a20333e1d0765dcfbb985da`) -> `pod-canary.zeabur.app`, port 20140.
- In-project Redis service (id `service-6a2021e61d0765dcfbb9817e`) backs `REDIS_URL`.
- `POD_HOST` (canary only) = prod service id; `POD_CANARY_HOST` (pod only) = canary service id. Used for canary <-> prod cross-calls.
- `PORT=20140` in production overrides the Dockerfile default of 20128.

## API Compatibility Policy

1. OpenAI-compatible routes (`/v1/*`) must follow official OpenAI API behavior — check docs before changes.
2. Anthropic-compatible routes (`/v1/messages`) must follow official Anthropic API behavior — check docs before changes.
3. Error shapes, auth headers, streaming format, model IDs, and tool calling must match official spec.
4. Any regression in compatibility is a release blocker — fix on canary before any merge to main.

## Reference-Checking Workflow

Before planning, fixing, or deploying:

1. Check current internet references for the task.
2. Read official OpenAI/Anthropic API docs when working on compatible routes.
3. Read relevant Context7 MCP docs and best practices when changing code/config/deployment.
4. Check Ponytail reference (github.com/DietrichGebert/ponytail) before spawning subagents.

## Verification Before Push

```bash
bun run check   # oxfmt + oxlint + tsc --noEmit
bun run test:run # vitest run (verbose)
bun run build   # NODE_ENV=production next build (turbopack)
```

## Cursor Cloud specific instructions

- **Default development branch**: `canary` (active). `main` is stable/release only — promote via PR.
- **Install (idempotent)**: `bash scripts/cloud-dev-install.sh` — ensures Bun 1.3.14+ and `bun install --frozen-lockfile`.
- **Start**: `bash scripts/cloud-dev-start.sh` — `bun run dev` on port **20128**. Requires secrets `JWT_SECRET` and `API_KEY_SECRET` (Cursor environment Secrets tab). Optional: `SHUTDOWN_SECRET`, `INITIAL_PASSWORD`.
- **Health check**: `curl -sf http://localhost:20128/api/health` → `{"ok":true}`; monitoring health is also public.
- **Verify before push**: `bun run check && bun run test:run && bun run build`.
- Do not commit `.env`; `.cursor/` is gitignored — configure Cloud environment via dashboard / `environment.json` proposal.

## Docs Map

| Path                            | Purpose                                       |
| ------------------------------- | --------------------------------------------- |
| .agents/INDEX.md                | Documentation index and reading order         |
| .agents/PRD.md                  | Product requirements document                 |
| .agents/architecture/\*         | System design deep dives                      |
| .agents/knowledge/\*            | Working knowledge (gotchas, conventions)      |
| .agents/issues/\*               | Historical audits and security analysis       |
| .agents/reports/\*              | Release rollups & verification reports        |
| .agents/plan/\*                 | Draft plans (migrations, optimization)        |
| .agents/compatibility-matrix.md | API compatibility matrix (OpenAI + Anthropic) |
| DESIGN.md                       | UI design system reference                    |
| CHANGELOG.md                    | Release history                               |
