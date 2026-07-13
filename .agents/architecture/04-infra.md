# Infrastructure Architecture

## Runtime Stack

| Component  | Choice                                           |
| ---------- | ------------------------------------------------ |
| Runtime    | Bun + Next.js 16 (standalone mode, Turbopack)    |
| Language   | TypeScript (strict mode); open-sse/ is frozen JS |
| Primary DB | SQLite at `~/.pod/pod.sqlite`                    |
| Cache DB   | Optional Redis (when `REDIS_URL` is set)         |
| Tunnel     | Optional Cloudflared                             |
| Mesh       | Optional Tailscale                               |

## Deployment

### Docker (Recommended)

Multi-stage build using `oven/bun:1.3.14-alpine`.

```bash
docker run -d --name pod -p 20128:20128 -v pod-data:/app/data lazuardytech/pod:latest
```

- Entrypoint forwards SIGTERM to child processes for graceful shutdown
- Data volume at `/app/data`

### Docker Compose

Includes Redis (rate limiting) and SearXNG (private web search).

```bash
cd docker && docker compose up -d
```

### Zeabur

Production deployment at **pod.lazuardy.tech** (port 20140). Canary at **pod-canary.zeabur.app**.

### Local Development

```bash
bun install && bun run dev  # http://localhost:20128
```

## Networking

| Record            | Target                        |
| ----------------- | ----------------------------- |
| pod.lazuardy.tech | Cloudflare proxied (A record) |

Cloudflare handles TLS termination, DDoS protection, and edge caching.

## Key Files

| File                     | Role                                                            |
| ------------------------ | --------------------------------------------------------------- |
| `src/instrumentation.ts` | Next.js 16 startup entry point                                  |
| `src/server-init.ts`     | Global process handlers, shutdown hooks                         |
| `src/lib/shutdown.ts`    | Graceful shutdown: signal handlers, queue flush, tunnel cleanup |
| `src/lib/tunnel/`        | Cloudflared tunnel management                                   |
| `src/lib/network/`       | Network utilities                                               |
| `docker/`                | Dockerfile and docker-compose.yml                               |
| `cloud/`                 | Cloudflare Worker backend                                       |

## Rules

| Rule                    | Why                                                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------------------------------- |
| SIGTERM forwarding      | Docker entrypoint must forward SIGTERM so cleanup handlers run                                                |
| Serialized tunnel spawn | Cloudflared tunnels must start one at a time                                                                  |
| Non-fatal fetchData     | Tunnel startup treats fetchData() failures as non-fatal                                                       |
| Simple health semantics | `GET /api/health`, `/api/monitoring/health`, and `/api/monitoring/health/stream` are public reads (no auth)   |
| Env-tunable body cap    | Request body cap defaults to 50MB via `POD_MAX_REQUEST_BODY_BYTES`; chat routes use `POD_MAX_CHAT_BODY_BYTES` |

## Watchlist

- **Multi-instance readiness**: SQLite + in-memory design is single-instance. Redis needed for coordination.
- **Tunnel lifecycle**: Cloudflared tunnels can drop; detect and restart automatically.
- **Cold-start relay**: Vercel relay has cold start delay; first request after idle may be slow.
- **Config drift**: Provider configs in `open-sse/config/` can drift from upstream API changes.
