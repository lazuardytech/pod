# Dev Workflow

## Package Manager

**bun only** (v1.3.14). Lockfile: `bun.lock`. Pinned in `package.json`.

```bash
bun install                  # install
bun install --frozen-lockfile # CI install
```

## Run / Build

```bash
bun run dev        # next dev --webpack --port 20128
bun run build      # NODE_ENV=production next build --webpack
bun run start      # bun ./.next/standalone/server.js
```

## Validation (Pre-Push Order)

```bash
bun run check      # biome format + biome lint + eslint (all-in-one)
bun run test:run   # vitest run --reporter=verbose
bun run build      # next build
```

`bun run format` for format-only passes.

## Docker

```bash
docker run -d --name pod -p 20128:20128 --env-file .env -v pod-data:/app/data lazuardytech/pod:latest
```

Dockerfile: multi-stage (builder `oven/bun:1.3.14-alpine` + runner). CMD: `bun /app/server.js` (no `--smol`). Cache env vars bound memory.

## CI/CD

| Workflow | File | Trigger |
|---|---|---|
| Build & Test | `.github/workflows/ci.yml` | Push/PR to `main` |
| Docker Publish | `.github/workflows/docker-publish.yml` | Tag push `v*` |
| Format (rwx) | `.rwx/format.yml` | Manual |
| Build (rwx) | `.rwx/build.yml` | Manual |
| Test (rwx) | `.rwx/test.yml` | Manual |

Docker image: `docker.io/lazuardytech/pod` (semver + latest). Platform: `linux/amd64`.

## Release Flow

1. Implement + validate: `bun run check` → `bun run test:run` → `bun run build`
2. Run `rwx run .rwx/build.yml` — wait for success
3. Bump version in **both** files: `package.json` + `src/shared/constants/config.js` `displayVersion`
4. Commit, tag `vX.Y.Z`, push branch + tag
5. Docker workflow publishes image from tag

## Storage

- SQLite: `~/.pod/pod.sqlite` (default, overridable via `DATA_DIR`)
- Schema migrations auto-apply at boot via `src/lib/sqlite/connection.js`
- `better-sqlite3` is devDependency only (tests under Node/vitest)
- Production uses `bun:sqlite`
