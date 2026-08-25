# Infrastructure Architecture

## Runtime Stack

| Component  | Choice                                                                                                                       |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Runtime    | Bun + Next.js 16 (standalone mode, Turbopack)                                                                                |
| Language   | TypeScript default (strict); authored `.ts`/`.tsx` only. Generated JS: `public/sw.js`. `open-sse/` is included in root `tsc` |
| Primary DB | SQLite at `~/.pod/pod.sqlite` (Zeabur: `$DATA_DIR/pod.sqlite`, `DATA_DIR=/app/data`)                                         |
| Cache DB   | Optional Redis (when `REDIS_URL` is set) — **rate limits only**                                                              |
| Tunnel     | Optional Cloudflared                                                                                                         |
| Mesh       | Optional Tailscale                                                                                                           |

## Deployment

### Docker (Recommended)

Multi-stage build using `oven/bun:1.4.0-alpine`.

```bash
docker run -d --name pod -p 20128:20128 -v pod-data:/app/data lazuardytech/pod:latest
```

- Entrypoint forwards SIGTERM to child processes for graceful shutdown
- Data volume at `/app/data`

### Docker Compose

Includes Redis (rate limiting) and SearXNG (private web search). Redis publishes host `6379` so `bun run dev` can use `REDIS_URL=redis://127.0.0.1:6379`.

```bash
cd docker && docker compose up -d redis   # local rate-limit Redis only
docker compose -f docker/docker-compose.yml up -d
```

Optional Headroom sidecar overlay (`docker/docker-compose.headroom.yml`): hostname `headroom`, fail-open. Local Python spawn is loopback-only (`/api/headroom/start`). Zeabur = `HEADROOM_URL` only (no sidecar).

```bash
cd docker && docker compose -f docker-compose.yml -f docker-compose.headroom.yml up -d
```

### Topology (locked)

- **Replicas: 1** per service. Do not scale `pod` or `pod-canary` horizontally. SQLite WAL is process-local.
- **Canary ≠ replica.** `pod` and `pod-canary` are isolated gateways with separate volumes. They share rate-limit Redis only, namespaced by `RATELIMIT_KEY_PREFIX` (`pod:` / `pod-canary:`).
- `POD_REPLICA_COUNT` defaults to `1`. Startup **warns**, and **throws in production**, if set `>1`.
- Production without `REDIS_URL` **warns** (in-memory rate limits). Never copy Zeabur `REDIS_URL` into git.

### SQLite backup

```bash
bun scripts/sqlite-backup.ts [dest]
```

Source is `$DATA_DIR/pod.sqlite` (local default `~/.pod`; Zeabur `DATA_DIR=/app/data`). Default dest: `$DATA_DIR/backups/pod-<timestamp>.sqlite`. Run as a one-shot or cron/sidecar against that volume. No Litestream in this wave.

### Zeabur

Production deployment at **pod.lazuardy.tech** (port 20140). Canary at **pod-canary.zeabur.app**. Each service: 1 replica, own SQLite volume, `DATA_DIR=/app/data`.

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

| File                       | Role                                                            |
| -------------------------- | --------------------------------------------------------------- |
| `src/instrumentation.ts`   | Next.js 16 startup entry point                                  |
| `src/server-init.ts`       | Global process handlers, shutdown hooks                         |
| `src/lib/shutdown.ts`      | Graceful shutdown: signal handlers, queue flush, tunnel cleanup |
| `src/lib/tunnel/`          | Cloudflared tunnel management                                   |
| `src/lib/network/`         | Network utilities                                               |
| `docker/`                  | Dockerfile and docker-compose.yml                               |
| `scripts/sqlite-backup.ts` | SQLite `VACUUM INTO` snapshot (`DATA_DIR=/app/data` on Zeabur)  |
| `cloud/`                   | Cloudflare Worker backend                                       |

## Rules

| Rule                    | Why                                                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------------------------------- |
| SIGTERM forwarding      | Docker entrypoint must forward SIGTERM so cleanup handlers run                                                |
| Serialized tunnel spawn | Cloudflared tunnels must start one at a time                                                                  |
| Non-fatal fetchData     | Tunnel startup treats fetchData() failures as non-fatal                                                       |
| Simple health semantics | `GET /api/health`, `/api/monitoring/health`, and `/api/monitoring/health/stream` are public reads (no auth)   |
| Env-tunable body cap    | Request body cap defaults to 50MB via `POD_MAX_REQUEST_BODY_BYTES`; chat routes use `POD_MAX_CHAT_BODY_BYTES` |

## Watchlist

- **Replicas stay 1**: SQLite is not shared across processes. Canary is a separate service, not a replica. Redis is rate-limit only (`RATELIMIT_KEY_PREFIX`).
- **Tunnel lifecycle**: Cloudflared tunnels can drop; detect and restart automatically.
- **Cold-start relay**: Vercel relay has cold start delay; first request after idle may be slow.
- **Config drift**: Provider configs in `open-sse/config/` can drift from upstream API changes.
