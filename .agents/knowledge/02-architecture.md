# Architecture

## Main Modules

- `src/`: Next.js app (dashboard UI + API routes)
- `open-sse/`: local routing engine, translators, executors
- `cloud/`: Cloudflare Worker companion

## Request Flow (high level)

1. Client calls compatibility endpoint (`/v1/*`, `/v1beta/*`, `/api/*`)
2. Next route applies auth + rate-limit checks
3. Request enters `open-sse` routing pipeline
4. Model/provider resolution + fallback strategy
5. Optional cache read and memory injection
6. Provider executor call
7. Stream/JSON translation back to client format
8. Usage and logs persisted

## Data and Reliability Layers

- SQLite-backed configuration and usage storage
- Transactional connection-lock updates to avoid race conditions
- SSE connection caps and idle timeouts
- Graceful shutdown with queue flush

## PWA / Offline Layers

- Manifest: `src/app/manifest.webmanifest`
- Service worker: `public/sw.js`
- Offline read cache: `offlineJsonCache`
- Offline write queue: `offlineMutationQueue`
- Background drain + status UI: `OfflineMutationProcessor`, `OfflineSyncStatus`
