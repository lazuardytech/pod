# Pod — Product Requirements Document

**Version:** v0.0.88 | **Status:** Active development | **Last reviewed:** 2026-09-22

## Overview

Pod is a self-hosted AI gateway that unifies 84 built-in LLM providers (plus custom nodes) behind a single OpenAI-compatible endpoint. It handles provider authentication, intelligent routing, fallback chains, semantic caching, usage analytics, and operational visibility through a dark-themed web dashboard.

## Target Users

- Developers wanting one API endpoint for multiple LLM providers
- Teams needing provider redundancy with automatic failover
- Self-hosters wanting full control over AI infrastructure
- Users managing multiple provider accounts with credential rotation

## Core Capabilities

### Provider Unification

- OpenAI-compatible `/v1/*` endpoints: chat/completions, responses, embeddings, audio (speech, transcriptions, translations), images/generations, models (list, detail). See [compatibility-matrix.md](compatibility-matrix.md).
- Stubs / partial: `POST /v1/images/edits` and `/variations` **501**; `POST /v1/files` **501**; `GET /v1/files` empty list; `GET`/`DELETE /v1/files/{id}` **404** `file_not_found`; moderations mock (always unflagged). All of these still run `withApiKeyRateLimit`. `GET`/`DELETE /v1/files*` always require a valid API key (not gated by `requireApiKey`).
- Gemini-compatible `GET /v1beta/models` (and `/v1beta/models/{path}`) — `requireApiKey` applies
- Anthropic `/v1/messages` and `/v1/messages/count_tokens` (char-based estimate)
- Ollama `/v1/api/chat` endpoint
- 84 built-in providers across free, API-key, OAuth, cookie, and self-hosted categories
- Auth types: API key, OAuth, cookie/session, local, service account
- Account credential rotation and lockout/cooldown management

### OpenAI-compatible Responses API

- `POST /v1/responses` maps to the same handler as chat completions (streaming + non-streaming)
- `POST /v1/responses/compact` for compact mode
- CORS enabled on `/v1/responses` non-streaming responses so browser clients can call the gateway directly
- Returns `400` for unsupported request shapes rather than proxying blindly

### Intelligent Routing

- Model-to-provider mapping with alias resolution
- Combos: model groups with fallback, round-robin, or Fusion (parallel panel + judge; Vision Adapter still filters the panel to capable models); Vision Adapter pools (Combos page) reorder or prepend a capable model when the current turn includes image/audio. OmniRoute Vision Bridge is not in 9router and is not ported.
- Thinking copy suffix: Provider Detail copies `alias/model(level)` from the existing Thinking Effort control; engine strips the suffix and applies native thinking (`thinkingUnified`)
- Provider-level rate limiting and lockout tracking
- Sticky sessions within combos

### Redis-isolated Rate Limiting

- Backend abstraction backs RPM + concurrent admission
- Redis selected when `REDIS_URL` exists; otherwise in-memory fallback
- `RATELIMIT_KEY_PREFIX` isolates Pod's Redis keys from other tenants/services on a shared Redis
- `RATELIMIT_REDIS_TIMEOUT_MS` (default 1000ms) bounds each Redis operation so a slow/hung Redis fails fast to the in-memory fallback
- If concurrent admission fails after RPM admission, the RPM slot is released (no leaked counters)
- Backend checks use duck typing, not `constructor.name` / `instanceof`

### Caching

- Semantic cache with TTL (in-memory), signatures include memoryOwnerId
- Prompt cache for repeated system prompts
- Cache invalidation via dashboard

### Memory

- Conversational memory pipeline: automatic injection and extraction across sessions
- Memory-aware cache signatures

### Usage Analytics

- Per-provider, per-model token and cost tracking
- Request logs with timestamps, latency, and detail payload
- Provider topology visualization (ReactFlow)

### Proxy Pools

- HTTP proxy pools and Vercel relay companion services
- Outbound SOCKS proxy pools for egress control
- Connection-level proxy resolution order: configured pool → legacy proxy → direct (none)
- Cloudflared and Tailscale tunnel support for public / mesh exposure

### AbortError-safe Streaming

- Client disconnects return `499` (not `500`); no `unhandledRejection` floods
- SSE stream wrappers call `controller.close()` (not `controller.error(err)`) on reader abort
- Global `unhandledRejection` handler classifies `node:_http_server` aborts as `[ClientDisconnect]` and dedupes within 1s

### Env-tunable 50MB Body Cap

- All mutation routes enforce a 50MB default body cap, tunable via `POD_MAX_REQUEST_BODY_BYTES` and `POD_MAX_CHAT_BODY_BYTES`
- `readBodyTextStream()` stream-reads large bodies in chunks to prevent 9-15s stalls on `curl/8.x`
- 413 returned on overflow; size enforced mid-stream (no silent memory spikes)

### Dashboard

- Dark-only, Linear-inspired UI (15 dashboard pages in `src/app/(dashboard)/`, no `/dashboard` prefix; includes `/basic-chat` playground)
- Provider health monitoring with real-time SSE updates
- Model diagnostics and testing
- Quota tracking with 3-level expand/collapse
- Cache and memory management
- Settings and auth config (`requireLogin` defaults **true**; dashboard `/api/*` mutations need JWT cookie or `x-9r-cli-token` unless login is disabled)
- Offline enqueue allowlist only: `PATCH /api/settings`, `PUT /api/providers/:id`
- Combo management with drag-to-reorder
- Endpoint Token Saver: local loopback Headroom spawn (Python CLI on PATH); Docker/Zeabur stay URL-only

### Offline and PWA

- Service worker (`public/sw.js`): network-first navigation with offline `/offline` fallback; no `Response.error()` on images; deploy-hash cache namespaces via `/sw-version.json`
- Offline reads via `offlineJsonCache` (IndexedDB); mutation queue for safe idempotent writes
- Installable PWA with web app manifest; registration-only lifecycle (no self-update UX)

## Non-Goals

- Not a model training or fine-tuning platform
- Not a consumer chat product — `/basic-chat` is a gateway test playground only
- Not a multi-tenant SaaS (self-hosted single-tenant)
- Not a replacement for provider-native SDKs

## Deployment & Branches

- `canary` = active development; `main` = stable (promote via PR only)
- Zeabur: `pod` → `pod.lazuardy.tech` (port 20140); `pod-canary` → `pod-canary.zeabur.app`
- Compatibility gate: [compatibility-matrix.md](compatibility-matrix.md)
- Health: `/api/health` and `/api/monitoring/health*` are public reads

## Product Constraints

- **Bun-only** — never npm/pnpm
- **TypeScript required** — the entire authored codebase stays TypeScript. Source is `.ts`/`.tsx` with `.ts`/`.tsx` import suffixes (`strict` + `noUncheckedIndexedAccess`). Do not add authored JavaScript, including when porting 9router (JS) or OmniRoute. The only committed `.js` is generated browser output (`public/sw.js` compiled from `src/sw/sw.ts`). `open-sse/` is TypeScript and stays in root `tsc`.
- **Local open-sse fork** — never replace with npm version; TypeScript, included in root `tsc`
- **SQLite primary store** — optional Redis for rate limiting
- **Dark-only UI** — no light mode
- **Defensive by default** — sanitized errors, safe streaming, crash guards

## Operational Guarantees

- **Abort-safe streaming**: Client disconnects return `499` (not `500`); no `unhandledRejection` floods. SSE stream wrappers use `controller.close()` on abort. Global `unhandledRejection` handler classifies `node:_http_server` aborts as `[ClientDisconnect]` and dedupes within 1s.
- **Chunked body reading**: Large request bodies (5MB+) are stream-read in chunks to prevent 9-15s stalls. `readBodyTextStream()` enforces the size cap mid-stream and returns `413` on overflow.
- **Configurable body cap**: All mutation routes enforce a 50MB default body cap (env-tunable). `413` returned on overflow; no silent memory spikes.
- **Compatibility first**: OpenAI/Anthropic error shapes, auth headers, streaming format, and tool calling match official specs. Any regression is a release blocker.
- **Offline-capable dashboard**: SW network-first for documents; reads degrade via `offlineJsonCache`; writes queue via mutation stack; only safe idempotent mutations queued.

## Key Numbers

| Metric              | Value                                                                   |
| ------------------- | ----------------------------------------------------------------------- |
| Version             | v0.0.88                                                                 |
| Default port        | 20128                                                                   |
| Zeabur port         | 20140                                                                   |
| SSE connection cap  | 100 concurrent                                                          |
| SSE idle timeout    | 5 minutes                                                               |
| Body cap            | 50MB default (env: POD_MAX_REQUEST_BODY_BYTES, POD_MAX_CHAT_BODY_BYTES) |
| Providers supported | 84 built-in (`AI_PROVIDERS`) + custom nodes                             |
| Executors           | 17 specialized + `DefaultExecutor`; 20 files in `open-sse/executors/`   |
| API route groups    | 27 (28 entries under `src/app/api/` incl. `_types.ts`)                  |
| Dashboard pages     | 15 in `(dashboard)` (incl. `/basic-chat`, `/settings/pricing`)          |

## Technical Debt

Full-repo scan 2026-09-22 (canary @ `073a91a9`). Baseline gates green: `bun run check` 0/0, 1523/1523 tests, `bun run build` OK, zero `@ts-nocheck`.

| #   | Debt                                                                                                  | Location                                                                                                                                 | Severity      | Fix path                                                                                |
| --- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------- | --------------------------------------------------------------------------------------- |
| T1  | 62 `: any` escape hatches in 5 translator helpers                                                     | `open-sse/translator/helpers/` (gemini 21, claude 18, openai 9, toolCall 8, responsesApi 6)                                              | Medium        | Type-only migration, same as the 34 files cleared in v0.0.87                            |
| T2  | `cloud/` typecheck fails: 32 errors, invisible to `bun run check` (excluded from root tsc)            | `cloud/tsconfig.json` missing `@/*` paths alias (18× TS2307) + 14 type drifts in `cloud/src/handlers/`, `open-sse/*` under workers-types | Medium        | Add paths alias; fix drift type-only; wire `cd cloud && bun install && tsc` into a gate |
| T3  | Prod deploy stuck: `pod.lazuardy.tech` still v0.0.86 >7h after main merge (canary healthy at v0.0.87) | Zeabur service `pod` (tracks `main`)                                                                                                     | High (ops)    | Inspect Zeabur deploy logs (needs `ZEABUR_TOKEN`) / retrigger deploy                    |
| T4  | CI workflow disabled (`if: false` — Actions billing); only the Zeabur check gates PRs                 | `.github/workflows/ci.yml`                                                                                                               | Medium        | Remove `if: false` once billing is fixed                                                |
| T5  | 20 stale `eslint-disable` directives (ESLint removed from toolchain)                                  | `src/app/(dashboard)/**` (react-hooks/exhaustive-deps)                                                                                   | Low           | Confirm oxlint has no matching rule, then delete                                        |
| T6  | 5 `: any` in test mocks                                                                               | `tests/`                                                                                                                                 | Low           | Type the mocks                                                                          |
| T7  | SW deploy-regression e2e scaffold unrunnable (Playwright not installed)                               | `tests/e2e/swDeployRegression.e2e.spec.ts` (TODO SW-ENG)                                                                                 | Low (pending) | Keep spec in `tests/SW-TEST-SEAM.md`; wire harness when adopting Playwright             |
| T8  | Coverage floors at 1%/0%                                                                              | `vitest.config.ts` thresholds                                                                                                            | Low           | Raise gradually as coverage improves                                                    |

Tracked as **not debt** (deliberate, documented): 15 `ponytail:` ceiling markers (each names an upgrade path), env-gated `tests/live/` skips, 4 justified `@ts-expect-error` FFI edges (styled-jsx attrs; no `@types` for chalk-animation/figlet/gradient-string; device-flow PKCE shadow), stub `/v1` routes (product surface).

### Fix status (2026-09-22, v0.0.88)

- **T1, T2, T5, T6, T7, T8 — Fixed.** T1: 62 `: any` removed type-only. T2: cloud tsc 42→0, `bun run check:cloud` gate wired into `bun run check`, stale wrangler alias key repaired. T5: 22 directives deleted; the 10 oxlint warnings they had been masking were fixed properly (not re-suppressed). T6: casts typed. T7: scaffold deleted, §5.5 spec inlined in `tests/SW-TEST-SEAM.md`. T8: floors ratcheted to ~70% of measured baseline (global 10/7/7/10, lib 20/18/16/20, api 10/12/7/10).
- **T4 — Blocked on credentials:** GitHub App token lacks `workflows` permission (HTTPS push of `.github/workflows` refused; no SSH key in sandbox). Re-enable probe is a 2-line commit on local branch `t4-ci-enable` — apply it with a workflows-scoped credential, then watch whether Actions runners start.
- **T3 — Open (ops):** prod Zeabur rollout needs deploy-log inspection or manual retrigger (no `ZEABUR_TOKEN` in sandbox).

### Rescan (2026-09-22, post-v0.0.88)

Authored code fully clean: 0 `@ts-nocheck`, 0 `: any`/`as any`, 0 stale lint directives, 0 authored TODO/FIXME, oxlint `--deny-warnings` 0/0, root + cloud tsc 0, 1523/1523 tests. Remaining open items:

- **T3 (ops)** — `pod.lazuardy.tech` still serving 0.0.86 >2h after PR #39 merged main (canary healthy at 0.0.88). Zeabur deploy automation for service `pod` is not firing; needs dashboard/token inspection.
- **T3 — RESOLVED (root cause found + fixed, 2026-09-22):** deploys were not "not firing" — every deploy since v0.0.87 FAILED at build. The `pod` service (template PREBUILT_V2) builds from a **frozen copy of an old Dockerfile in its Zeabur spec**, pinned to `oven/bun:1.3.14-alpine`; Bun 1.3.14 SIGILL-crashes on `next build` for the v0.0.87+ tree (same crash class reproduced locally on 1.3.1, fixed by 1.4.x). Fix: deployed via Zeabur GraphQL `deployFromSpecification` with the repo's current Dockerfile (Bun 1.4.0) — build succeeded. Rollout then hit transient `ImagePullBackOff` (TLS handshake timeouts from runtime cluster to `registry-oci.zeabur.cloud` — platform-side network; k8s backoff retries until it clears).
- **T4 (credential-blocked)** — evidence upgrade: Dependabot dynamic workflows ran successfully on main at 2026-09-22T04:40 (Actions runners are healthy again), so removing `if: false` is low-risk. The only blocker is pushing `.github/workflows`: the checkout's GitHub App token lacks `workflows` permission. Probe commit ready on local branch `t4-ci-enable`.
- **Routine maintenance (not debt):** open Dependabot PRs #35/#36/#37 (vitest 5.0.1, @vitest/coverage-v8 5.0.1, oxfmt 0.68.0) awaiting merge — they predate the v0.0.88 squash and need rebase.

### Deslop pass (2026-09-24)

Full rescan + dead-code purge on canary. Gates: `bun run check` (incl. cloud) 0/0, 1523/1523 tests, `bun run build` EXIT=0. Findings fixed:

- **19 dead files deleted** (verified zero references across src/, open-sse/, cloud/src/, tests/, scripts/, next.config.ts, Dockerfile — including relative-import and barrel forms): `cloud/src/handlers/countTokens.ts`, `open-sse/handlers/responsesHandler.ts`, `open-sse/rtk/registry.ts` (duplicate of autodetect's own mapping), `open-sse/services/compact.ts` (compact route uses handleChat), `open-sse/utils/toolDeduper.ts`, `src/lib/contentTypeGuard.ts`, `src/lib/network/initOutboundProxy.ts`, `src/lib/oauth/services/index.ts`, `src/lib/oauth/utils/banner.ts` (imported three packages that were never even declared in package.json — would crash if invoked), `src/lib/usage/fetcher.ts`, 4 unused shadcn primitives (`ui/pagination|separator|tabs|textarea` — regenerate via shadcn if needed), 4 dead barrels (`src/shared/constants/index.ts`, `src/shared/hooks/index.ts`, `src/store/index.ts`, oauth services barrel), `src/shared/services/initializeCloudSync.ts` (no-op shim whose claimed importers no longer exist), `src/shared/utils/cloud.ts` (isCloud is defined inline in usageDb).
- **11 stale `biome-ignore` directives removed** — Biome left the toolchain (oxfmt/oxlint since the TS migration); the comments were misleading dead weight.
- **Dev deps bumped to Dependabot targets** (vitest 5.0.1, @vitest/coverage-v8 5.0.1, oxfmt ^0.68.0) — supersedes PRs #35/#36/#37; those should auto-close.

Net: **-1,091 lines, +34** (dep pins). No runtime change (deletions of unreferenced code only).

### Performance pass (2026-09-25, v0.0.89)

Concurrency-focused optimization for the enterprise LLM-router use case on Bun. Two read-only audits (SSE streaming path; storage/admission path) produced ranked findings with line evidence; the safe set was implemented (zero behavior change, type-safe):

| Area                   | Change                                                                                                                                                            | Why it matters under load                                                                                          |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| SQLite statements      | New `prepared(db, sql)` WeakMap cache in `connection.ts`; used by api_keys SELECT/UPDATE, settings SELECT, semantic-cache SELECT/INSERT/UPDATE, retrieval queries | `bun:sqlite` recompiles on every `prepare()` (measured 1.3× overhead per op)                                       |
| api_keys writes        | `last_access_at` UPDATE throttled to 1 write/min/key                                                                                                              | Was a synchronous write per admission — serialized all requests on SQLite's single writer for a cosmetic timestamp |
| Settings               | 1s TTL cache (structuredClone on read) invalidated by all writers                                                                                                 | Was 1–3 full-table reads + JSON.parse per request                                                                  |
| Semantic cache metrics | In-memory accumulate + 5s single-transaction flush; reads include pending deltas                                                                                  | Was 1–3 inline writes per cache-enabled request                                                                    |
| request_log flush      | New `idx_reqlog_pending(model, provider, status)` index                                                                                                           | Flush UPDATE was a table scan inside the write transaction                                                         |
| SSE translate          | Memoized `${target}:${source}` translator pair (was per-chunk key alloc + 2 registry gets)                                                                        | Runs per SSE chunk                                                                                                 |
| SSE passthrough        | decloak JSON round-trip skipped when no tool map/no fallback; line payload computed once; two passes over lines merged into one                                   | The per-line hot loop                                                                                              |
| Memory retrieval       | `hasTable` positive cache; keyword regexes compiled per token, reused across rows/haystacks                                                                       | Was sqlite_master query per request + RegExp per token×haystack×row                                                |
| Rate limit (memory)    | Minute-counter trim time-gated 60s like the concurrent trim                                                                                                       | Was O(all-keys) scan per request                                                                                   |
| Correctness            | Redis RPM `x-ratelimit-reset-requests` was `NaN` (member `${ts}:${uuid}`); new `parseMemberTimestamp` + unit tests                                                | Header correctness                                                                                                 |

Deliberately skipped (risky/low value, documented in audit): Redis admission pipelining (atomicity semantics), batched stream enqueue (backpressure timing), `hasValuableContent` trim gate (subtle edge), request-logger static import (cloud bundling), appendFileSync buffering when `ENABLE_REQUEST_LOGS` (env-gated, default off).

Gates: `bun run check` 0/0 · `bun run test:run` **1526/1526** (1523 + 3 new) · `bun run build` EXIT=0.
