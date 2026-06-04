# .agents Index

Compact project knowledge for contributors and coding agents.

## Current Baseline

- Project: `pod`
- Version: `v0.0.79`
- Runtime: bun + Next.js 16 + local `open-sse`
- Focus areas: routing reliability, provider compatibility, security hardening, PWA/offline-first, Redis rate limiting

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

## Reports

Historical reports are under `.agents/reports/`.
- [Security Hardening — Phase 1-4 Audit (v0.0.79)](reports/security-hardening-v0.0.79.md)

## Plans

Feature plans and architecture proposals are under `.agents/plan/`.
- [Optimizing Pod for Multiple Instance](plan/optimizing-pod-for-multiple-instance.md) — LiteFS, Redis, load balancing

## Key Libraries

| Library | Path | Purpose |
|---------|------|---------|
| `sanitizeError` | `src/lib/sanitizeError.js` | Production-safe error messages |
| `parseJsonBody` | `src/lib/parseJsonBody.js` | Safe JSON body parsing |
| `rateLimit` | `src/lib/rateLimit/` | Redis/in-memory rate limiter |
| `localDb` | `src/lib/localDb.js` | SQLite query facade |
| `shutdown` | `src/lib/shutdown.js` | Graceful shutdown orchestrator |
