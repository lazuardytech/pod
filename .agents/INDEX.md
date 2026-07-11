# Pod — Documentation Index

**Version:** v0.0.82 | **Stack:** Bun + Next.js 16 (TS, strict mode) + open-sse (local JS fork) + SQLite | **Port:** 20128 | **Deployed at:** pod.lazuardy.tech

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

| File                                                         | Covers                                                     |
| ------------------------------------------------------------ | ---------------------------------------------------------- |
| [architecture/00-engine.md](architecture/00-engine.md)       | open-sse engine: routing, translation, streaming, caching  |
| [architecture/01-app.md](architecture/01-app.md)             | Next.js pages, API routes, middleware, PWA, stores         |
| [architecture/02-providers.md](architecture/02-providers.md) | Provider config, auth types, executors, translators, retry |
| [architecture/03-data.md](architecture/03-data.md)           | SQLite, Redis, offline cache, mutation queue               |
| [architecture/04-infra.md](architecture/04-infra.md)         | Docker, Zeabur, Cloudflare, networking                     |
| [architecture/05-flow.md](architecture/05-flow.md)           | End-to-end request flow: streaming, non-streaming, failure |

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
| [knowledge/04-gotchas.md](knowledge/04-gotchas.md)           | Common traps (parser quirks, Turbopack, abort)     |
| [knowledge/05-open-issues.md](knowledge/05-open-issues.md)   | Active watchlist                                   |

---

## Other Directories

| Path     | Purpose                                                           |
| -------- | ----------------------------------------------------------------- |
| issues/  | Historical audit and security analysis — verify against live code |
| reports/ | Release rollups and verification reports by version               |
| plan/    | Draft plans (multi-instance optimization, JS-to-TS migration)     |

> **Note**: Issues files are historical snapshots. Always cross-check findings against live code before acting.
