# Infrastructure Architecture

## Runtime Stack

| Component | Choice |
|---|---|
| Runtime | Bun + Next.js 16 (standalone mode) |
| Primary DB | SQLite at `~/.pod/pod.sqlite` |
| Cache DB | Optional Redis (when `REDIS_URL` is set) |
| Tunnel | Optional Cloudflared |
| Mesh | Optional Tailscale |

## Deployment

### Docker

Multi-stage build using `oven/bun:1.3.14-alpine`. Entrypoint forwards SIGTERM to child processes for graceful shutdown.

### Zeabur

Production deployment on Zeabur at **pod.lazuardy.tech**.

### Docker Compose

Local development stack includes Redis and SearXNG for search functionality.

## Networking

| Record | Target |
|---|---|
| pod.lazuardy.tech | Cloudflare proxied (A record to `43.157.213.211`) |

Cloudflare handles TLS termination, DDoS protection, and caching at the edge.

## Rules

- **SIGTERM forwarding**: Docker entrypoint must forward SIGTERM to child processes so cleanup handlers run.
- **Serialized tunnel spawn**: Cloudflared tunnel startup must be serialized (one at a time, not concurrent).
- **Simple health semantics**: `GET /api/health` is public and returns a simple status. Monitoring endpoints (`/api/monitoring/health`) require API key auth.

## Watchlist

- **Multi-instance readiness**: Current SQLite+memory design is single-instance. Multi-instance will need Redis for coordination and shared state.
- **Tunnel lifecycle**: Cloudflared tunnels can drop unexpectedly; the system should detect and restart them without user intervention.
- **Cold-start relay**: Vercel relay has a cold start delay. First request after idle may be slow.
- **Config drift**: Provider configs in `open-sse/config/` can drift from upstream API changes. Monitor periodically.
