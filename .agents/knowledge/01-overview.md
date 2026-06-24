# Overview

**Pod** is a self-hosted AI gateway — a unified proxy for 50+ LLM providers behind a single OpenAI-compatible endpoint.

| Fact | Value |
|------|-------|
| Version | v0.0.79 |
| Stack | Bun + Next.js 16 (JS, no TS) + open-sse (local fork) + SQLite |
| Port | 20128 |
| Deployed at | pod.lazuardy.tech (Zeabur, Cloudflare DNS) |
| Data dir | `~/.pod/pod.sqlite` |
| Health | `GET /api/health` (public) |
| License | MIT |

## Three Layers

| Layer | What | Where |
|-------|------|-------|
| **App** | Next.js pages, API routes, middleware, PWA | `src/` |
| **Engine** | Provider routing, format translation, streaming | `open-sse/` |
| **Data & Ops** | SQLite, cache, rate limiting, tunnels | `src/lib/` |

## Repo Layout

| Path | Purpose |
|------|---------|
| `src/` | App layer (pages, API, lib, shared, sse) |
| `open-sse/` | Local engine fork (routing, translation, streaming) |
| `cloud/` | Cloudflare Worker backend |
| `tests/` | Vitest test suite (unit + smoke) |
| `docker/` | Dockerfile and docker-compose.yml |
| `docs/` | Internal API reference |
| `.agents/` | This documentation |

## Key Entry Points

| File | Role |
|------|------|
| `src/server-init.js` | Server startup, signal handlers |
| `src/proxy.js` | Next.js middleware (route matching) |
| `src/dashboardGuard.js` | JWT auth guard |
| `open-sse/index.js` | Engine public API |
| `src/lib/localDb.js` | Primary database access |
| `src/shared/constants/config.js` | Version, app config |
| `src/shared/constants/providers.js` | Provider definitions |
| `AGENTS.md` | Operational rules |
| `README.md` | Quick start and env reference |
