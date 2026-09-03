# AGENTS.md

Operational rules for AI agents working on the **Pod** project.

## Learned User Preferences

- Uses `/ponytail lite|full|ultra` heavily (default full; `ultra` = delete-before-add, challenge scope). "stop ponytail" / "normal mode" reverts. Leverages parallel subagents for multi-phase work (explore → audit → plan → build → verify).
- Communicates operational/planning requests in Indonesian; expects concise, no-essay responses for routine ops, full detail when explicitly asked for a report/walkthrough.
- Wants zero leftover uncommitted changes — after substantive work, commit and push ALL uncommitted changes to `origin canary` so nothing drifts. Never leave changes unpushed. After canary is green, promote via PR to main, merge when checks pass, and keep canary/main on the same commit.
- Before any Zeabur deploy, user expects all env vars on every service (pod/pod-canary) verified complete and valid to avoid build/runtime failures. After push to canary or merge to main, confirm GitHub workflow plus both Zeabur services deployed the latest commit.
- Prefers docs kept concise and structured in English; wants `.agents/INDEX.md` as a clean, accurate map of all docs and AGENTS/.agents refreshed together after repo changes. Keep DESIGN.md aligned with the shadcn dashboard visual system, and keep PRD stating authored source is TypeScript (only generated JS is `public/sw.js`).
- Interactive dashboard controls (buttons, icon buttons, button groups) must use shadcn-backed shared components (`@/shared/components`); segmented tab controls are not wrapped in Card.
- Default `bun run test:run` must report zero skipped tests; live/network harnesses belong in `tests/live/` (`bun run test:live`). Mock in the default suite instead of `it.skip`. Dashboard route unit tests that hit `checkDashboardApiAuth` must call `disableDashboardLogin()` from `tests/helpers/apiRouteHarness.ts` (`requireLogin` defaults true)—do not add JWT/CLI tokens to every Request, and do not leave a failing suite half-fixed.

## Learned Workspace Facts

- `/api/monitoring/health` + `/api/monitoring/health/stream` are PUBLIC reads (auth guard removed, `src/app/api/monitoring/health/_auth.tsx` deleted) — consistent with `/api/health`. Health dashboard `/health` fetches them unauthenticated; the old 401 caused the "Network unavailable. Showing cached health snapshot." toast on prod.
- `changelogUrl` in `src/shared/constants/config.ts` uses `refs/heads/canary` (never `master` — dead branch 404s).
- Zeabur git source: service `pod` tracks `main`; service `pod-canary` tracks `canary`.
- Rate-limit env: `RATELIMIT_KEY_PREFIX` (Redis namespace isolation: `local:` locally, `pod:` / `pod-canary:` on Zeabur) and `RATELIMIT_REDIS_TIMEOUT_MS` (default 1000) — must appear in README env table.
- `bun run format` / `check` / `lint` must use lockfile binaries (`oxfmt`, `oxlint`, `tsc`) — never `bun x oxlint`, which floats past bun.lock (1.79+ enables `react(set-state-in-effect)`). oxlint `--deny-warnings` treats warnings as errors (exit non-zero); without it, warnings print but check still passes. `bun run check` also runs `scripts/check-open-sse-ts-nocheck.ts` (new `@ts-nocheck` under `open-sse/` fails; current files are allowlisted).
- `.gitignore` ignores agent-tool dirs: `.codegraph`, `.astro`, `.mimocode`, `.opencode`, `mastracode`, `.rwx` (plus `.cursor`, `.commandcode`, `.pi`, `.claude`); do not commit those dirs.
- open-sse/executors/ is 20 `.ts` files: 17 specialized executors + `default.ts` + `base.ts` + `index.ts`. `getExecutor()` registers 19 map keys (`cu` aliases cursor; Vertex covers `vertex` and `vertex-partner`); unknown providers get `DefaultExecutor`. Do not count the file total as "provider count". Executors/translators live in the typed `open-sse/` fork, not `src/lib/`.
- HTTPS git push of `.github/workflows` can fail without GitHub `workflow` scope; SSH push works.
- Chrome `ERR_FAILED` interstitial after idle (fixed by hard reload) is often SW-side: `public/sw.js` must keep network-first navigation, never reject `respondWith`, and avoid `Response.error()` (esp. images); `ServiceWorkerRegistrar` must not blind `location.reload()` on every `controllerchange`. RSC/`?_rsc=` fetches are not SW-intercepted (idle CF/TLS is a separate failure mode).
- `next.config.ts` sets `turbopack.root` to `import.meta.dirname` so Next does not infer `/home/ubuntu` from a home-level `pnpm-lock.yaml`.
- `.env` is gitignored; `JWT_SECRET` and `API_KEY_SECRET` are required at process start even in development — generate local values, never copy Zeabur prod secrets. `.env.example` is local-first (`PORT=20128`); Zeabur uses `PORT=20140`, `DATA_DIR=/app/data`, and in-project Redis via `REDIS_URL` (`REDIS_HOST` is unused). SQLite stays the primary store (one volume per service); do not migrate to Postgres or Kafka. Redis is rate-limit only — local Redis for tests (`docker/docker-compose.yml` publishes 6379), Zeabur in-project Redis for deploy.
- Primary upstream reference is 9router (`decolua/9router`, last cloned ~0.4.x); OmniRoute (`diegosouzapw/OmniRoute`) is secondary. Do not reintroduce features Pod dropped (e.g. MITM). OmniRoute Vision Bridge / 14-engine compression is not in 9router and is not ported.

## Project Identity

- **Project name**: pod, v0.0.86
- **Runtime**: Bun 1.4.0 + Next.js 16 (TypeScript default, strict mode)
- **Engine**: open-sse/ (local fork, not npm, TypeScript; `.ts` import suffixes)
- **Data**: SQLite at ~/.pod/pod.sqlite
- **Port**: 20128 (local/Docker) / 20140 (Zeabur `PORT`)
- **Health**: GET /api/health and `/api/monitoring/health*` (public)
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
11. TypeScript is the default. Authored files are `.ts`/`.tsx` with `.ts`/`.tsx` import suffixes. The only committed JavaScript is generated (`public/sw.js` from `src/sw/sw.ts`).

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
8. Stateful internal APIs self-authenticate via `routeAuth.ts` (no middleware.ts). `checkDashboardApiAuth` allows unauthenticated access when `requireLogin` is false (default **true**); JWT cookie or `x-9r-cli-token` otherwise. `checkStrictDashboardAuth` always requires a token (OAuth import, tunnel, cloud auth). Public: health, login/logout, `GET /api/settings/require-login`. Stub `/v1` 501/404/mock routes still go through `withApiKeyRateLimit` (`GET /v1/files*` always requires an API key even if `requireApiKey=false`).
9. SSRF protection must block 0.0.0.0 and DNS-rebinding-style hosts.
10. Authored source is TypeScript (`strict` + `noUncheckedIndexedAccess`). Do not add authored `.js`/`.jsx`. Generated JS is only `public/sw.js` (from `src/sw/sw.ts`). Local imports use `.ts`/`.tsx` suffixes.
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
8. Keep the outer crash guard in open-sse/utils/stream.ts.
9. Keep the guarded peek-reader behavior in open-sse/handlers/chatCore.ts.
10. open-sse/ is TypeScript (strict, included in `tsc`). Local imports use `.ts`/`.tsx` suffixes (`allowImportingTsExtensions`). Do not replace the local fork with the npm package. Do not add authored `.js` — the only committed JS is generated (`public/sw.js` from `src/sw/sw.ts`).
11. Regex literals with flags that look unterminated to Turbopack must use `new RegExp()` — apply in any file where Turbopack fails to parse a regex literal.
12. `src/instrumentation.ts` is the canonical startup path (Next.js 16). It must stay Edge-safe (no `node:` imports); Node startup (`initializeApp()` + signal handlers) lives in `src/instrumentation.node.ts`. Do not add `turbopackIgnore` on that import — it makes `next dev` fail with `Cannot find module './instrumentation.node.ts'`. Side-effect imports in layout.tsx for startup code have been removed.
13. AbortError at `node:_http_server` (client disconnect) must be classified as `[ClientDisconnect]`, not `[FATAL]`. SSE stream wrappers use `controller.close()` (not `controller.error(err)`) on reader abort. See `.agents/knowledge/04-gotchas.md` item 31.
14. `cloud/` remains excluded from root `tsc` (has its own tsconfig). `open-sse/` is included. Prefer importing typed symbols from `open-sse/`; keep cross-boundary constants inlined in `src/` when bundling constraints require it (e.g. rate-limit headers).
15. `next.config.ts` `serverExternalPackages` must include `undici` (and `bun:sqlite`). undici v8 throws a bare `Error` when Turbopack bundles its top-level code into the standalone server chunk, breaking dynamic `import("undici")` in server routes (`src/app/api/proxy-pools/[id]/test/route.ts`) and `src/lib/network/`. Keep undici external (loaded from `node_modules` at runtime) — never bundle it.

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
7. Thinking block leak fix: open-sse/translator/response/claude-to-openai.ts — do NOT emit `<think>` or `</think>` as content delta.

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
- **Install (idempotent)**: `bash scripts/cloud-dev-install.sh` — ensures Bun 1.4.0+ and `bun install --frozen-lockfile`.
- **Start**: `bash scripts/cloud-dev-start.sh` — `bun run dev` on port **20128**. Requires secrets `JWT_SECRET` and `API_KEY_SECRET` (Cursor environment Secrets tab). Optional: `SHUTDOWN_SECRET`, `INITIAL_PASSWORD`.
- **Health check**: `curl -sf http://localhost:20128/api/health` → `{"ok":true}`; monitoring health is also public. Zeabur dashboard Health Check must be `/api/health` (kubelet `GET /` with 1s timeout flaps Ready under combo load; see gotcha §35).
- **Tests need Node ≥ 22.18 on PATH (not bun)**: `bun run test:run` runs vitest under `node` on purpose (a health test asserts `version.bun` is `null`, which only holds under node). The pre-provisioned `/exec-daemon/node` is v22.14.0 — too old for native `.mts` type-stripping — so it throws `Unknown file extension ".mts"` on `src/shared/utils/clineAuth.mts` (2 spurious failures). Prepend nvm's newer node first, e.g. `export PATH="$HOME/.nvm/versions/node/v22.22.2/bin:$PATH"`, then `bun run test:run` → all green. `bun run check`/`bun run build` are unaffected (they run under bun).
- **Build**: `bun run build` compiles `src/sw/sw.ts` → `public/sw.js`. Docker `COPY /app/open-sse` copies TypeScript sources; Bun resolves `.ts` import specifiers directly (no JS shims).
- **Verify before push**: `bun run check && bun run test:run && bun run build`.
- **Ponytail skills**: vendored at `.agents/skills/{ponytail,ponytail-review,ponytail-audit,ponytail-debt,ponytail-gain,ponytail-help}/` (Cloud discovers `.agents/skills/`; `.cursor/` is gitignored). Invoke `/ponytail lite|full|ultra` (default **full**). Stop: `stop ponytail` / `normal mode`. Upstream: [DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail).
- Do not commit `.env`; `.cursor/` is gitignored — configure Cloud environment via dashboard / `environment.json` proposal.

## Docs Map

| Path                            | Purpose                                       |
| ------------------------------- | --------------------------------------------- |
| .agents/INDEX.md                | Documentation index and reading order         |
| .agents/skills/\*               | Cursor agent skills (ponytail suite)          |
| .agents/PRD.md                  | Product requirements document                 |
| .agents/architecture/\*         | System design deep dives                      |
| .agents/knowledge/\*            | Working knowledge (gotchas, conventions)      |
| .agents/issues/\*               | Historical audits and security analysis       |
| .agents/reports/\*              | Release rollups & verification reports        |
| .agents/plan/\*                 | Draft plans (migrations, optimization)        |
| .agents/compatibility-matrix.md | API compatibility matrix (OpenAI + Anthropic) |
| README.md                       | Project overview, quick start, env reference  |
| DESIGN.md                       | UI design system (tokens + shadcn adapters)   |
| CONTRIBUTING.md                 | Dev workflow, PR conventions                  |
| SECURITY.md                     | Vulnerability reporting                       |
| CHANGELOG.md                    | Release history                               |

## Open Debt (actionable only)

- **CHANGELOG header** — still `[Unreleased]`; cut to `## [0.0.86] - 2026-09-03` on next release.
- **CI is disabled (`if: false` since 2026-09-02 GitHub Actions billing failure)** — `.github/workflows/ci.yml:14` and the workflow only triggers on `main` (not `canary`). When billing is restored, also add `canary` to the push trigger.
- **Dependabot disabled** — `.github/dependabot.yml` has `updates: []`. Re-enable for `bun.lock` + `package.json` when desired.
- **Dead-code in `src/shared/services/initializeCloudSync.ts`** — file is 31 lines, the actual scheduler code is fully commented out, only `cleanupProviderConnections()` runs. Strip the dead `/* ========== */` blocks (or delete the file).
- **Multi-instance scaling** — `plan/optimizing-pod-for-multiple-instance.md` still planning. Single SQLite volume per service is the current constraint.
- **Doc drift (low-priority cleanup)**:
  - `plan/openai-compat-fixes.md` header still says "v0.0.82".
  - `reports/release-rollup-v0.0.80-v0.0.82.md` L9 still says "open-sse/ intentionally frozen as JS" (the file has an inline correction but the wording is misleading).
  - `issues/NEW_SECURITY_ISSUES_2026-06-07.md` + `REMAINING_ISSUES_2026-06-07.md` are empty "Historical Note" stubs.
- **Rollup v0.0.83 → v0.0.86** — three releases have no `release-rollup-v0.0.83-v0.0.86.md`; only CHANGELOG covers them. INDEX.md L81 flags this.
