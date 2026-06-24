# Pod — Documentation Index

**Version:** v0.0.79
**Stack:** Bun + Next.js 16 + open-sse + SQLite
**Deployment:** Zeabur → pod.lazuardy.tech (Docker, multi-stage Bun + Tailscale)
**Engine:** open-sse/ (local fork, not npm)

## Read First

For new contributors, read in this order:

1. **PRD.md** — product overview and goals
2. **knowledge/01-overview.md** — what Pod is, quick facts
3. **knowledge/02-conventions.md** — coding and naming conventions
4. **knowledge/03-dev-workflow.md** — dev commands and workflow
5. **knowledge/04-gotchas.md** — common traps
6. **knowledge/05-open-issues.md** — active watchlist

## Documentation Map

### Root Level
| File | Purpose |
|------|---------|
| AGENTS.md | Operational rules for AI agents |
| README.md | Project overview, quick start, env reference |
| DESIGN.md | UI design system (dark-only, Linear-inspired) |
| CHANGELOG.md | Release history |
| CONTRIBUTING.md | Contribution guidelines |
| SECURITY.md | Security policy |
| docs/API_INTERNAL.md | Internal Dashboard API reference |

### .agents/ (this directory)

| Path | Purpose |
|------|---------|
| INDEX.md | This file — entry point |
| PRD.md | Product requirements document |

### architecture/
| File | Purpose |
|------|---------|
| 00-engine.md | open-sse engine design |
| 01-app.md | App layer (Next.js pages, routes, middleware) |
| 02-providers.md | Provider config, auth, executors, translators |
| 03-data.md | Storage (SQLite, Redis, offline cache) |
| 04-infra.md | Infrastructure (Docker, Zeabur, Cloudflare) |
| 05-flow.md | End-to-end request flow |

### knowledge/
| File | Purpose |
|------|---------|
| 01-overview.md | Project overview and key facts |
| 02-conventions.md | Coding and naming conventions |
| 03-dev-workflow.md | Development commands and workflow |
| 04-gotchas.md | Common traps and pitfalls |
| 05-open-issues.md | Active watchlist and known issues |

### issues/
Historical audit and security analysis files. See issues/INDEX.md.
These are historical context — verify against live code before acting.

### reports/
Release rollups and verification reports organized by version.
Historical context for understanding past decisions.

### plan/
| File | Purpose |
|------|---------|
| optimizing-pod-for-multiple-instance.md | Multi-instance plan (draft) |
