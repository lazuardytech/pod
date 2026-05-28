# Dev Workflow

## Package Manager

Use **bun only** (v1.3.14).

```bash
bun install
bun install --frozen-lockfile
```

Repo config:
- `bun.lock` is the lockfile
- `packageManager` pinned in `package.json`

## Run / Build

```bash
bun run dev        # next dev --webpack --port 20128
bun run build      # production build
bun run start      # bun ./.next/standalone/server.js (Next.js standalone)
```

## Validation Commands

```bash
bun run check      # biome format + biome lint + eslint (all-in-one, canonical pre-push)
bun run format     # biome format --write . (format only)
bun x eslint .     # lint only
bun run test:run   # vitest
bun run build      # next build
```

Always run in this order before release: `bun run check` → `bun run test:run` → `bun run build`.

> Test count as of v0.0.56: **1224 tests passed** (60 test files), 19 skipped (3 require live infra).

## Docker (Local)

```bash
docker run -d --name pod -p 20128:20128 --env-file .env -v pod-data:/app/data lazuardytech/pod:latest
```

(`start.sh` was removed in v0.0.20; release baseline is v0.0.56.)

Dockerfile facts:
- Multi-stage build:
  - Builder: `oven/bun:1.3.14-alpine` + `--ignore-scripts` (skips native compile)
  - Runner: `oven/bun:1.3.14-alpine`
- Entrypoint: `/entrypoint.sh` — fixes volume permissions, starts `tailscaled` in userspace mode, then `exec su-exec bun`
- CMD: `bun /app/server.js` (no `--smol`; memory bounded via cache env vars)
- Cache env vars set in Dockerfile: `SEMANTIC_CACHE_MAX_BYTES=2097152`, `SEMANTIC_CACHE_MAX_SIZE=50`, `PROMPT_CACHE_MAX_BYTES=1048576`, `PROMPT_CACHE_MAX_SIZE=25`
- Runtime port: `20128`
- Data dir: `/app/data` (volume mount); `~/.pod` symlinked to `/app/data-home` inside container

## CI/CD Workflows

### Build & Test
File: `.github/workflows/ci.yml`
- Trigger: push/PR to `main`, manual dispatch
- Steps: bun install → `bun run check` (lint) → `bun run test:run` → `bun run build`

### Format
File: `.rwx/format.yml` — runs `bun run format` via rwx

### Build (rwx)
File: `.rwx/build.yml` — runs `bun run build` via rwx

### Test (rwx)
File: `.rwx/test.yml` — runs `bun run test:run` via rwx

### Build & Push Docker Image
File: `.github/workflows/docker-publish.yml`
- Trigger: tag push `v*`, manual dispatch
- Image: `docker.io/lazuardytech/pod`
- Platforms: `linux/amd64`
- Tags: semver + `latest`

## Release Flow

1. Implement + validate: `bun run check` → `bun run test:run` → `bun run build`
2. Run rwx build: `rwx run .rwx/build.yml` — wait for success
3. Bump version in **both**:
   - `package.json` → `"version"`
   - `src/shared/constants/config.js` → `displayVersion`
4. Commit, tag `vX.Y.Z`, push branch + tag
5. Docker workflow publishes image from tag

## Storage Notes

- SQLite file: `~/.pod/pod.sqlite`
- Schema migrations run automatically at boot via `src/lib/sqlite/connection.js`
- `better-sqlite3` is devDependency only (tests run under Node/vitest)
- Production uses `bun:sqlite`
