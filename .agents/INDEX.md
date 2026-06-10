# .agents Index

Compact project knowledge for contributors and coding agents.

## Current Baseline

- Project: `pod`
- Version: `v0.0.79`
- Runtime: bun + Next.js 16 + local `open-sse`
- Focus areas: security hardening, SSE crash guards, Redis rate limiting, Zeabur deployment, multi-instance planning, PWA/offline-first

## Core Knowledge

- [01 Overview](knowledge/01-overview.md)
- [02 Architecture](knowledge/02-architecture.md)
- [03 Providers and Routing](knowledge/03-providers-and-routing.md)
- [04 API Surface](knowledge/04-api-surface.md)
- [05 Dev Workflow](knowledge/05-dev-workflow.md)
- [06 Conventions](knowledge/06-conventions.md)
- [07 Gotchas](knowledge/07-gotchas.md)
- [08 Skills System](knowledge/08-skills-system.md)
- [09 Fork Status](knowledge/09-fork-status.md)
- [10 Open Issues](knowledge/10-open-issues.md)
- [20 Edit Tool Guidelines](knowledge/20-edit-tool-guidelines.md)

## Architecture Deep Dives

- [00 Engine Architecture](architecture/00-engine.md) — open-sse engine: routing, executors, translators, streaming
- [01 App Architecture](architecture/01-app.md) — Next.js app: routes, pages, stores, PWA
- [02 Provider Integrations](architecture/02-providers.md) — provider configs, OAuth, token refresh, credential management
- [03 Data Layer](architecture/03-data.md) — SQLite schema, localDb, cache, memory, usage tracking
- [04 Infrastructure](architecture/04-infra.md) — Docker, tunnels, rate limiting, Cloudflare Worker
- [05 Request Flow](architecture/05-flow.md) — end-to-end request lifecycle

## Reports

Historical reports are under `.agents/reports/`.
- [Security Hardening — Phase 1-4 Audit (v0.0.79)](reports/security-hardening-v0.0.79.md)
- [Release Rollup v0.0.57 → v0.0.78](reports/release-rollup-v0.0.57-v0.0.78.md)
- [Release Rollup v0.0.32 → v0.0.56](reports/release-rollup-v0.0.32-v0.0.56.md)

## Plans

Feature plans and architecture proposals are under `.agents/plan/`.
- [Optimizing Pod for Multiple Instance](plan/optimizing-pod-for-multiple-instance.md) — LiteFS, Redis, load balancing

## PRD

- [Product Requirements Document](PRD.md) — goals, personas, features, non-functional requirements

## Reference Docs

- [Internal API Reference](../docs/API_INTERNAL.md) — dashboard and internal endpoint reference

## Key Libraries

| Library | Path | Purpose |
|---------|------|---------|
| `sanitizeError` | `src/lib/sanitizeError.js` | Production-safe error messages |
| `parseJsonBody` | `src/lib/parseJsonBody.js` | Safe JSON body parsing |
| `rateLimit` | `src/lib/rateLimit/` | Redis/in-memory rate limiter |
| `localDb` | `src/lib/localDb.js` | SQLite query facade |
| `shutdown` | `src/lib/shutdown.js` | Graceful shutdown orchestrator |
| `open-sse` | `open-sse/` | Core proxy engine (local, never from npm) |
| `tunnel` | `src/lib/tunnel/` | Cloudflared + Tailscale tunnel management |
