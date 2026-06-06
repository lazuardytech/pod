# Infrastructure — Docker, Tunnels, Rate Limiting, Cloud

## Docker Deployment

### Dockerfile (Multi-Stage Alpine)
```
Stage 1: builder (oven/bun:alpine)
  ├─ Copy source + open-sse
  ├─ bun install --production
  └─ bun run build (next build → standalone)

Stage 2: runner (oven/bun:alpine)
  ├─ Copy standalone output from builder
  ├─ Copy open-sse/ from builder
  ├─ EXPOSE 3000
  └─ ENTRYPOINT trap SIGTERM → forward to children
  └─ CMD bun /app/server.js
```

### Docker Compose
```yaml
services:
  pod:
    build: .
    ports: ["3000:3000"]
    volumes: [pod-data:/root/.pod]
    environment:
      REDIS_URL: redis://redis:6379
    healthcheck: GET /api/health → 200 OK

  redis:
    image: redis:7-alpine
    restart: always

  searxng:
    image: searxng/searxng
    restart: always
```

### Entrypoint
- Traps SIGTERM and forwards signal to all children
- Ensures cloudflared and tailscaled get clean shutdown
- Queue flush on container stop

## Tunnels

### Cloudflare Tunnel (`src/lib/tunnel/cloudflared.js`)
- Downloads `cloudflared` binary (platform-aware)
- `spawnCloudflared(port, hostname)`: Named tunnel with DNS
- `spawnQuickTunnel(port)`: Ephemeral `trycloudflare.com` tunnel
- Serialized spawn via `spawnLock` (prevents concurrent overwrites)
- `killExistingProcess()` before new spawn
- Process tracking via PID file

### Tailscale (`src/lib/tunnel/tailscale.js`)
- Installation: brew/pkg/msi/shell script
- Daemon control: userspace with socket (`--tun=userspace-networking`)
- `startLogin(authkey)`: Authenticate
- `startFunnel(port)`: Enable Tailscale Funnel
- `stopFunnel()`, `stopDaemon()`: Cleanup

### Tunnel Manager (`src/lib/tunnel/tunnelManager.js`)
- `enableTunnel()`, `disableTunnel()`, `getTunnelStatus()`
- `enableTailscale()`, `disableTailscale()`, `getTailscaleStatus()`
- Per-service state: cancelToken, spawnInProgress, lastRestartAt
- Health probing: `networkProbe.js` — check internet + poll `/api/health`

## Rate Limiting

### Backend Abstraction (`src/lib/rateLimit/backend.js`)
```javascript
// Auto-selects based on REDIS_URL env var
if (process.env.REDIS_URL) {
  backend = new RedisBackend(redisUrl)
  await backend.connect()
} else {
  backend = new MemoryBackend()  // in-memory fallback
}
```

### Redis Backend (`src/lib/rateLimit/redis.js`)
- Zero npm dependency: uses `Bun.RedisClient` native
- **RPM**: Sorted set sliding window
  - Member ID: `${timestamp}:${uuid8}` (no same-millisecond collisions)
  - Clean old entries on check
  - Count remaining → pass or 429
- **Concurrent**: `INCR` on start, `DECR` on finish
  - Safety TTL to prevent stale counters
- **Release RPM**: `REMRANGEBYRANK` when concurrent check fails after RPM passes
- Duck-type dispatch: `backend.releaseRpm?.(...)` — never `constructor.name`

### Memory Backend (`src/lib/rateLimit/memory.js`)
- Minute counters with TTL-based trash collection
- Concurrent counters with `lastAccess` periodic trim
- `releaseRpm`: No-op (memory counters self-expire)

### Public API (`src/lib/rateLimit/index.js`)
```javascript
// Wrap a handler with rate limiting
withApiKeyRateLimit(request, async () => { ... })

// Check rate limit directly
checkRateLimitByKey(apiKey)

// Optional RPM release
backend.releaseRpm?.(apiKeyId, member)
```

### Rate Limit Flow
1. Extract API key from request (header `Authorization: Bearer <key>`)
2. Look up API key record in SQLite (rpm limit, concurrent limit)
3. Check RPM via `backend.checkRequestLimit` → 429 if exceeded
4. Check concurrent via `backend.checkConcurrentLimit` → 429 if exceeded
5. If concurrent check fails after RPM passes → `backend.releaseRpm()`
6. On stream cancel/disconnect → release concurrent slot

## Cloudflare Worker (`cloud/`)

Self-hosted edge proxy. Can expose a Pod instance through Cloudflare's edge network.

### Architecture
```
cloud/
├── src/
│   ├── index.js              # Worker fetch handler (router)
│   ├── handlers/             # chat, embeddings, cache, sync, cleanup, etc.
│   ├── services/             # storage (D1+KV), landingPage, tokenRefresh
│   └── stubs/                # usageDb stub (replaces bun:sqlite)
├── migrations/               # D1 schema
└── wrangler.toml             # Worker + bindings config
```

### Key Differences from Main App
- No `bun:sqlite` — uses Cloudflare D1 (SQLite-over-HTTP) and KV for storage
- `wrangler.toml` aliases `@/lib/usageDb.js` → `./src/stubs/usageDb.js`
- `cloud/src/handlers/testClaude.js` — stub returning 410 (must remain)
- Token refresh and API key derivation adapted for Worker context
