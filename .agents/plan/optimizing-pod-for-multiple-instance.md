# Plan: Optimizing Pod for Multiple Instance

Status: **Planning** | Target: Pod v0.1.0+ | Date: 2026-06-04

## Overview

Current Pod runs as single instance with local SQLite (`~/.pod/pod.sqlite`). This plan
migrates Pod to multi-instance deployment: shared SQLite via LiteFS, distributed rate
limiting via Redis, and load-balanced frontend — all deployable to Zeabur Docker.

## Goals

1. Multi-instance Pod behind load balancer — 2-3 replicas
2. Shared SQLite state via LiteFS primary-replica (no cloud managed service)
3. Redis mandatory for distributed rate limiting across replicas
4. Zero data loss on deploy/restart — persistent storage on Zeabur
5. All existing functionality preserved: cache, memory, logs, locks, config

## Target Architecture

```
                    ┌──────────────┐
                    │   Zeabur LB  │  (round-robin, sticky sessions)
                    └──────┬───────┘
           ┌───────────────┼───────────────┐
           ▼               ▼               ▼
    ┌──────────┐    ┌──────────┐    ┌──────────┐
    │ Pod #1   │    │ Pod #2   │    │ Pod #3   │
    │ Primary  │    │ Replica  │    │ Replica  │
    └────┬─────┘    └────┬─────┘    └────┬─────┘
         │               │               │
         │  ┌────────────┼───────────────┘
         │  │            │
         ▼  ▼            ▼
    ┌──────────┐    ┌──────────┐
    │  Redis   │    │  LiteFS  │  (primary-replica, no external consensus)
    │ rate     │    │  SQLite  │
    │ limits   │    │  data    │
    └──────────┘    └────┬─────┘
                         │
                    ┌────▼─────┐
                    │ MinIO /  │  (S3-compatible for LTX replication log)
                    │ S3 bucket│
                    └──────────┘
```

## Infrastructure Changes

### 1. Persistent Storage (Zeabur)

**Prerequisite**: Zeabur Docker services must support persistent volume mounts.
Without this, all state (SQLite, LiteFS) is lost on every deploy.

```yaml
# docker-compose snippet
services:
  pod:
    volumes:
      - pod-data:/var/lib/pod          # LiteFS SQLite data dir
      - litefs-data:/var/lib/litefs    # LiteFS FUSE mount + metadata

volumes:
  pod-data:
  litefs-data:
```

### 2. Redis Service (Already Deployed)

Zeabur already has a `redis` service (`6a2021e61d0765dcfbb9817e`).

Redis is **mandatory** for multi-instance — rate limit counters must be shared.
Without Redis, each instance has independent counters, defeating rate limiting.

```yaml
environment:
  REDIS_URL: redis://<redis-service-host>:6379
```

### 3. LiteFS Sidecar

LiteFS runs as sidecar **inside the same Docker container** as Pod. It mounts SQLite
database directory via FUSE, transparently proxying writes to primary and serving
reads from local replica.

**LiteFS configuration** (`/etc/litefs.yml`):

```yaml
fuse:
  dir: "/var/lib/pod"

data:
  dir: "/var/lib/litefs"

exec:
  # Run Pod as subprocess managed by LiteFS
  - cmd: "bun /app/server.js"

proxy:
  # HTTP proxy for forwarding writes from replicas to primary
  addr: ":20202"
  target: "localhost:20128"

lease:
  type: "static"
  candidate: ${FLY_REGION == 'primary'}  # Or use env var POD_ROLE=primary|replica
  hostname: ${HOSTNAME}
  advertise-url: "http://${HOSTNAME}:20202"

# LTX replication logs written to S3-compatible storage
# Use MinIO self-hosted, Cloudflare R2, or AWS S3
```

### 4. MinIO (S3-Compatible Replication Log Storage)

LiteFS needs S3-compatible storage for LTX (replication log) files. MinIO is the
lightest self-hosted option for Zeabur.

```yaml
services:
  minio:
    image: minio/minio:latest
    command: server /data --console-address :9001
    environment:
      MINIO_ROOT_USER: pod
      MINIO_ROOT_PASSWORD: ${MINIO_PASSWORD}
    volumes:
      - minio-data:/data

volumes:
  minio-data:
```

Alternatively: **Cloudflare R2** (free tier: 10GB, zero egress). Solves the
persistent volume problem entirely — no MinIO container needed.

## Code Changes

### 1. SQLite Connection Abstraction (`src/lib/sqlite/connection.js`)

Current: `better-sqlite3` (Node.js) or `bun:sqlite` (Bun), both direct file access.

LiteFS integration is **transparent at SQL level** — LiteFS intercepts file operations
at FUSE level. No code changes to SQL queries required.

**What changes:**
- Database file path: `~/.pod/pod.sqlite` → `/var/lib/pod/pod.sqlite` (LiteFS FUSE mount)
- Remove `tryEnsureDir()` — LiteFS handles directory
- Add health check: verify LiteFS FUSE mount is alive
- Add read-only mode detection: replica instances can still serve reads

**Estimated LOC change**: ~20 lines in `connection.js`. Zero changes to 30+ callers.

### 2. Dockerfile

```dockerfile
# Add LiteFS binary
RUN curl -L https://github.com/superfly/litefs/releases/download/v0.5.11/litefs-linux-arm64.tar.gz \
    -o /tmp/litefs.tar.gz && \
    tar -xzf /tmp/litefs.tar.gz -C /usr/local/bin && \
    chmod +x /usr/local/bin/litefs

COPY litefs.yml /etc/litefs.yml

# Entrypoint: LiteFS mounts FUSE then execs Pod
ENTRYPOINT ["litefs", "mount"]
```

### 3. Environment Variables

```bash
POD_ROLE=primary|replica           # Which instance is write primary
POD_INSTANCE_ID=pod-1|pod-2|pod-3  # Unique per instance
REDIS_URL=redis://redis:6379       # Mandatory for multi-instance
LITEFS_S3_ENDPOINT=https://...     # MinIO or R2 endpoint
LITEFS_S3_ACCESS_KEY=...
LITEFS_S3_SECRET_KEY=...
```

## Load Balancing Strategy

### Zeabur Load Balancer

Zeabur provides built-in HTTP load balancing for services with multiple replicas.

**Algorithm**: Round-robin (default)

**Potential issue with sticky sessions:**
- Memory injection (conversational memory) works per-request — no session affinity needed
- API keys are validated from SQLite (shared via LiteFS) — stateless
- Rate limits are enforced via Redis — shared across instances
- **Conclusion**: No sticky sessions needed. Pure round-robin works.

### Health Check

```bash
GET /api/health → 200 OK

# LiteFS-aware health: replica returns 200 but may indicate read-only mode
# Primary returns 200 with write-capable flag
```

## Rate Limiting Strategy

### Architecture

Rate limiting is **already implemented** with Redis backend abstraction
(`src/lib/rateLimit/`). For multi-instance:

| Component | Backend | Why |
|-----------|---------|-----|
| RPM (requests per minute) | Redis sorted set | Sliding window, shared across instances |
| Concurrent (active requests) | Redis INCR/DECR | Atomic counter, shared across instances |
| Fallback | In-memory | Degrades gracefully if Redis is unreachable |

### Configuration

```bash
REDIS_URL=redis://redis:6379   # Mandatory. Without this, rate limits are per-instance.
```

### Multi-Instance Behavior

- Instance A checks RPM for API key `xyz`: Redis counter shows 45/60 → pass
- Instance B checks RPM for API key `xyz`: Redis counter shows 45/60 → pass (shared counter)
- Instance C checks RPM for API key `xyz`: Redis counter shows 47/60 → pass
- Instance A checks RPM for API key `xyz`: Redis counter shows 60/60 → 429

All three instances share the same RPM window and concurrent counter.
**No rate limit bypass possible.**

### Graceful Degradation

If Redis connection drops mid-flight:
- `backend.js` reconnects on next `initRateLimit()` call
- In-memory `release()` calls silently succeed (Redis handles expiry via TTL anyway)
- Pending requests complete normally
- New requests fall back to in-memory (per-instance, degraded)

## Migration Plan

### Phase 1 — Verify Zeabur Persistent Volumes

- Confirm Zeabur Docker services support named volume mounts
- Test with a simple Pod deployment + volume mount
- Verify data survives restart/deploy
- **If not supported**: Evaluate Cloudflare R2 for LTX + SQLite file in R2 (higher latency for initial reads)

### Phase 2 — Deploy Redis (Done)

Redis service already deployed on Zeabur. `REDIS_URL` already configured in docker-compose.
Rate limiting backend already auto-selects Redis when URL is set.

### Phase 3 — Deploy MinIO (If R2 Not Chosen)

- Create MinIO Docker service on Zeabur
- Create bucket `pod-litefs`
- Generate access key + secret

### Phase 4 — Pod LiteFS Integration

- Add LiteFS binary to Dockerfile
- Add `litefs.yml` configuration
- Modify `connection.js` database path
- Deploy **single primary instance** first with LiteFS (same as current — verify stability)
- Add health endpoint LiteFS-awareness

### Phase 5 — Multi-Instance Rollout

- Deploy Pod replica #2 with `POD_ROLE=replica`
- Deploy Pod replica #3 with `POD_ROLE=replica`
- Verify all instances share SQLite state
- Verify rate limits are enforced globally via Redis
- Verify reads from replicas are correct

### Phase 6 — Load Balancer

- Configure Zeabur load balancer for `pod` service (already available for multi-replica services)
- Route traffic to all instances
- Monitor for consistency issues

## Risks & Mitigations

| Risk | Severity | Mitigation |
|------|----------|------------|
| Zeabur doesn't support persistent volumes | High | Fallback to Cloudflare R2 for LTX (no local FUSE — LiteFS proxy mode over HTTP) |
| Zeabur doesn't allow FUSE | High | LiteFS read-only replica mode + HTTP proxy to primary for writes. Higher latency but no FUSE needed. |
| Split-brain (two primaries) | Medium | Static lease (env-var driven, not consensus) — only one instance has `POD_ROLE=primary` |
| LiteFS replication lag | Low | Typically <100ms. Read-after-write consistency: primary always serves latest reads |
| Redis overload | Low | Rate limit counters are tiny (sorted set + INCR). Redis handles this at sub-millisecond latency |
| Redis connection leak | Low | `Bun.RedisClient` auto-reconnects. In-memory fallback for transient failures |

## Testing Strategy

### Unit Tests
- Redis backend unit tests already exist (`tests/unit/api-key-rate-limit.test.js`)
- Add: LiteFS read-only mode detection test

### Integration Tests
- Multi-instance rate limit test: spin 3 Pods against 1 Redis, verify shared counter
- LiteFS replication test: write to primary, verify read from replica within 200ms
- Failover test: kill primary, verify replica continues serving reads

### Production Smoke Test
- Deploy 3 instances to Zeabur
- Run 100 concurrent requests against LB
- Verify: custom rate limits enforced globally
- Verify: model locks don't deadlock (transactional in SQLite)
- Verify: cache hits on one instance visible to others

## Dependencies

| Dependency | Version | Purpose |
|------------|---------|---------|
| LiteFS | v0.5.11+ | Distributed SQLite via FUSE |
| Redis | 7.x | Rate limit counter store (already deployed) |
| Bun.RedisClient | native | Zero-dependency Redis client (already integrated) |
| MinIO | latest | S3-compatible LTX storage (or Cloudflare R2) |

## Notes

- **LiteFS not cloud managed**: Runs as a binary inside the Docker container. No external service, no subscription. Self-contained.
- **Zeabur FUSE availability**: This is the critical unknown. LiteFS require FUSE to intercept SQLite file operations. If Zeabur blocks FUSE (`/dev/fuse`), Plan B is LiteFS proxy mode where replicas forward all SQL queries to primary via HTTP. Higher latency but works without FUSE.
- **Single-writer model**: Only the primary instance handles writes. Replicas forward writes to primary via LiteFS transparently. This is acceptable for Pod — most requests are reads (health checks, model listing) or idempotent writes (usage logging).
- **Redis mandatory**: Without Redis, multi-instance rate limiting is impossible. In-memory counters are per-instance.
