# Pod — Documentation Index

> **pod · v0.0.86** · Bun + Next.js 16 + open-sse (typed local fork) + SQLite · port **20128** (Zeabur **20140**) · [pod.lazuardy.tech](https://pod.lazuardy.tech)
> Self-hosted AI gateway unifying 84 built-in LLM providers behind one OpenAI-compatible endpoint.

> **Last reviewed**: 2026-09-04.
> **Freshness notes**:
>
> - Dashboard APIs: `checkDashboardApiAuth` / `checkStrictDashboardAuth` (`src/lib/routeAuth.ts`). `requireLogin` defaults true. Stub `/v1` files/edits/variations/moderations keep 501/404/empty/mock **and** `withApiKeyRateLimit`. `bun run check` starts with `scripts/check-open-sse-ts-nocheck.ts`. Rate-limit prefixes: `local:` / `pod:` / `pod-canary:`. Compose Redis publishes **6379**. SQLite replicas=1; backup `bun scripts/sqlite-backup.ts`.
>
> - Authored source is TypeScript (`.ts`/`.tsx` import suffixes). The only committed JavaScript is generated `public/sw.js` (from `src/sw/sw.ts`). No `open-sse/**/*.js` shims. Porting 9router stays TypeScript.
> - Combos Fusion: per-combo Fallback / RR / Fusion (parallel panel + judge). Vision Adapter still filters the panel to hard-cap-capable models. Non-chat (TTS/image/search) coerces fusion → fallback.
> - Token Saver: RTK + Headroom (`/v1/compress` HTTP client; **local Python spawn** on loopback via `/api/headroom/start|stop|restart`, or compose overlay `docker/docker-compose.headroom.yml`) + Caveman + Ponytail on Endpoint. Combos Vision Adapter reorders/prepends capable models. `X-Pod-Token-Saver: off` skips all savers. OmniRoute Vision Bridge is not in 9router / not ported.
> - Thinking copy suffix: Provider Detail copies `alias/model(level)` from Thinking Effort; `thinkingUnified` strips the suffix and maps native thinking. Codex still accepts hyphen `-{effort}` after paren strip.
> - `/api/monitoring/health` and `/api/monitoring/health/stream` are **public reads** (no API key), on par with `/api/health`.
> - Service worker (`public/sw.js`): **network-first** navigation + offline fallback; never reject `respondWith` / never `Response.error()` on images; no blind `controllerchange` reload. See gotcha §34 (`knowledge/04-gotchas.md`).
> - `open-sse/executors/`: 20 files (17 specialized + `default.ts` + `base.ts` + `index.ts`). Do not call the file total "19 providers".
> - `AI_PROVIDERS` in `src/shared/constants/providers.ts` has **84** built-in ids. Custom OpenAI/Anthropic/embedding nodes are extra.
> - Primary UI token is alabaster (`--color-primary: #e5e5e6`), not neon-lime. Dashboard controls are shadcn adapters (`src/shared/components`) over `src/shared/components/ui`. See `DESIGN.md`.
> - Tooling is **oxfmt + oxlint + tsc** from bun.lock (`oxlint@1.73.0`). Do not use `bun x oxlint` — it floats to 1.79+ and fails `--deny-warnings` on new React compiler rules. Branch from **`canary`**, not `main`.
> - Compatibility: `POST /v1/images/edits`, `/images/variations`, and `POST /v1/files` are **501**. `GET`/`DELETE /v1/files/{id}` return **404**. Moderations is a mock (always unflagged). Stub routes still use `withApiKeyRateLimit`; `GET`/`DELETE /v1/files*` always require an API key. See [compatibility-matrix.md](compatibility-matrix.md).

---

## Reading Order (New Contributors)

1. [PRD.md](PRD.md) — what Pod is, goals, constraints
2. [knowledge/01-overview.md](knowledge/01-overview.md) — quick facts, repo layout
3. [knowledge/02-conventions.md](knowledge/02-conventions.md) — coding and naming rules
4. [knowledge/03-dev-workflow.md](knowledge/03-dev-workflow.md) — commands, verification
5. [knowledge/04-gotchas.md](knowledge/04-gotchas.md) — common traps
6. [knowledge/05-open-issues.md](knowledge/05-open-issues.md) — active watchlist

---

## Architecture Deep Dives

| File                                                         | Covers                                                         |
| ------------------------------------------------------------ | -------------------------------------------------------------- |
| [architecture/00-engine.md](architecture/00-engine.md)       | open-sse engine: routing, translation, streaming, crash guards |
| [architecture/01-app.md](architecture/01-app.md)             | Next.js pages, API routes, routeAuth, PWA, stores              |
| [architecture/02-providers.md](architecture/02-providers.md) | Provider config, auth types, executors, translators, retry     |
| [architecture/03-data.md](architecture/03-data.md)           | SQLite, Redis, offline cache, mutation queue                   |
| [architecture/04-infra.md](architecture/04-infra.md)         | Docker, Zeabur, Cloudflare, networking                         |
| [architecture/05-flow.md](architecture/05-flow.md)           | End-to-end request flow: streaming, non-streaming, failure     |

---

## Reference Docs

| File                                               | Purpose                                       |
| -------------------------------------------------- | --------------------------------------------- |
| [AGENTS.md](../AGENTS.md)                          | Operational rules for AI agents               |
| [README.md](../README.md)                          | Project overview, quick start, env reference  |
| [DESIGN.md](../DESIGN.md)                          | UI design system (tokens + shadcn adapters)   |
| [CONTRIBUTING.md](../CONTRIBUTING.md)              | Contributor workflow (bun, canary, oxfmt)     |
| [SECURITY.md](../SECURITY.md)                      | Vulnerability reporting                       |
| [CHANGELOG.md](../CHANGELOG.md)                    | Release history                               |
| [compatibility-matrix.md](compatibility-matrix.md) | API compatibility matrix (OpenAI + Anthropic) |

---

## Knowledge (Working Notes)

| File                                                         | Covers                                             |
| ------------------------------------------------------------ | -------------------------------------------------- |
| [knowledge/01-overview.md](knowledge/01-overview.md)         | Quick facts, repo layout, three-layer architecture |
| [knowledge/02-conventions.md](knowledge/02-conventions.md)   | Coding, naming, body parsing, modal rules          |
| [knowledge/03-dev-workflow.md](knowledge/03-dev-workflow.md) | Commands, pre-push verification, Zeabur deploy     |
| [knowledge/04-gotchas.md](knowledge/04-gotchas.md)           | Common traps (parser, Turbopack, abort, SW §34)    |
| [knowledge/05-open-issues.md](knowledge/05-open-issues.md)   | Active watchlist                                   |

---

## Other Directories

| Path     | Purpose                                                                                                                                                                                                                                                                                                          |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| skills/  | Cursor agent skills — ponytail suite from [DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail) (`/ponytail`, `/ponytail-review`, `/ponytail-audit`, `/ponytail-debt`, `/ponytail-gain`, `/ponytail-help`)                                                                                       |
| issues/  | Historical audits (2026-06) — start at [issues/INDEX.md](issues/INDEX.md); verify against live code. Not a current backlog.                                                                                                                                                                                      |
| reports/ | Release rollups and verification reports by version. Latest: [reports/release-rollup-v0.0.83-v0.0.86.md](reports/release-rollup-v0.0.83-v0.0.86.md); previous: [reports/release-rollup-v0.0.80-v0.0.82.md](reports/release-rollup-v0.0.80-v0.0.82.md)                                                            |
| plan/    | [js-to-ts-migration.md](plan/js-to-ts-migration.md) (completed; open-sse is TS), [openai-compat-fixes.md](plan/openai-compat-fixes.md) (largely shipped), [optimizing-pod-for-multiple-instance.md](plan/optimizing-pod-for-multiple-instance.md), [voidzero-adoption.md](plan/voidzero-adoption.md) (completed) |
| tests/   | SW seams: [../tests/SW-TEST-SEAM.md](../tests/SW-TEST-SEAM.md); unit `tests/unit/swShellCache.test.ts`                                                                                                                                                                                                           |

---

> **Note**: Issues files and older reports are historical snapshots. Always cross-check findings against live code before acting.
