# Pod — Documentation Index

> **pod · v0.0.82** · Bun + Next.js 16 + open-sse (local JS fork) + SQLite · port **20128** · [pod.lazuardy.tech](https://pod.lazuardy.tech)
> Self-hosted AI gateway unifying 50+ LLM providers behind one OpenAI-compatible endpoint.

> **Last reviewed**: 2026-07-24.
> **Freshness notes**:
>
> - `/api/monitoring/health` and `/api/monitoring/health/stream` are **public reads** (no API key), on par with `/api/health`. Ignore older docs that claim auth.
> - Service worker (`public/sw.js`): **network-first** navigation + offline fallback; never reject `respondWith` / never `Response.error()` on images; no blind `controllerchange` reload. See gotcha §34 (`knowledge/04-gotchas.md`).

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
| [DESIGN.md](../DESIGN.md)                          | UI design system (dark-only, Linear-inspired) |
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

| Path     | Purpose                                                                                                                                                                                                                                                                        |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| issues/  | Historical audits — start at [issues/INDEX.md](issues/INDEX.md); verify against live code                                                                                                                                                                                      |
| reports/ | Release rollups and verification reports by version                                                                                                                                                                                                                            |
| plan/    | [js-to-ts-migration.md](plan/js-to-ts-migration.md) (completed), [openai-compat-fixes.md](plan/openai-compat-fixes.md), [optimizing-pod-for-multiple-instance.md](plan/optimizing-pod-for-multiple-instance.md), [voidzero-adoption.md](plan/voidzero-adoption.md) (completed) |
| tests/   | SW seams: [../tests/SW-TEST-SEAM.md](../tests/SW-TEST-SEAM.md); unit `tests/unit/swShellCache.test.js`                                                                                                                                                                         |

---

> **Note**: Issues files are historical snapshots. Always cross-check findings against live code before acting.
