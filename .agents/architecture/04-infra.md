# Infrastructure Architecture

Pod is designed to run locally or in self-hosted environments with optional remote access and shared runtime components.

## Runtime Pieces

- Bun + Next.js application
- Local SQLite database
- Optional Redis for distributed rate limiting
- Optional Cloudflare Worker integration
- Optional Cloudflared and Tailscale tunnels
- Docker and Zeabur-style deployment support

## Important Deployment Rules

1. Docker entrypoint must forward SIGTERM to child processes.
2. Tunnel startup and shutdown must stay serialized and recoverable.
3. Redis is optional for single-instance use, but preferred for multi-instance correctness.
4. Health and readiness semantics must remain simple and stable.

## Current Watchlist

- Multi-instance data strategy
- Tunnel lifecycle robustness
- Cold-start behavior and relay reliability
- Deployment-time config drift
