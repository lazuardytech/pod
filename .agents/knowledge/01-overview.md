# Overview

**Pod** is a self-hosted AI gateway — a unified proxy for 50+ LLM providers behind a single OpenAI-compatible endpoint.

| Fact        | Value                                                                     |
| ----------- | ------------------------------------------------------------------------- |
| Version     | v0.0.82                                                                   |
| Stack       | Bun + Next.js 16 (TS, strict mode) + open-sse (typed local fork) + SQLite |
| Port        | 20128                                                                     |
| Deployed at | pod.lazuardy.tech (Zeabur, Cloudflare DNS)                                |
| Data dir    | `~/.pod/pod.sqlite`                                                       |
| Health      | `GET /api/health` + `/api/monitoring/health*` (public)                    |
| License     | MIT                                                                       |

## Three Layers

| Layer          | What                                            | Where       |
| -------------- | ----------------------------------------------- | ----------- |
| **App**        | Next.js pages, API routes, routeAuth, PWA       | `src/`      |
| **Engine**     | Provider routing, format translation, streaming | `open-sse/` |
| **Data & Ops** | SQLite, cache, rate limiting, tunnels           | `src/lib/`  |

## Repo Layout

| Path        | Purpose                                             |
| ----------- | --------------------------------------------------- |
| `src/`      | App layer (pages, API, lib, shared, sse)            |
| `open-sse/` | Local engine fork (routing, translation, streaming) |
| `cloud/`    | Cloudflare Worker backend                           |
| `tests/`    | Vitest test suite (unit + smoke)                    |
| `docker/`   | Dockerfile and docker-compose.yml                   |
| `.agents/`  | This documentation                                  |

## Key Entry Points

| File                                | Role                                |
| ----------------------------------- | ----------------------------------- |
| `src/instrumentation.ts`            | Next.js 16 startup, signal handlers |
| `src/server-init.ts`                | Global process handlers             |
| `open-sse/index.ts`                 | Engine public API                   |
| `src/lib/localDb.ts`                | Primary database access             |
| `src/shared/constants/config.ts`    | Version, app config                 |
| `src/shared/constants/providers.ts` | Provider definitions                |
| `AGENTS.md`                         | Operational rules                   |
| `README.md`                         | Quick start and env reference       |
