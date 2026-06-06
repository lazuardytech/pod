# Dev Workflow

## Package Manager

Use **bun only**.

## Main Commands

```bash
bun install
bun run dev
bun run check
bun run test:run
bun run build
```

## Release Checklist

1. `bun run check`
2. `bun run test:run`
3. `bun run build`
4. Bump both version fields:
   - `package.json` (`version`)
   - `src/shared/constants/config.js` (`displayVersion`)
5. Tag release and push

## Docker Notes

- Image: `lazuardytech/pod`
- Runtime command: `bun /app/server.js`
- Multi-stage Alpine build with Bun
- Docker compose: pod + redis + searxng
- open-sse copied into standalone output: `COPY --from=builder /app/open-sse ./open-sse`

## Zeabur Deployment

- Dockerfile at repo root for Zeabur Docker service
- Redis service required for distributed rate limiting
- `REDIS_URL` env var for Redis connection
- Persistent volume needed for SQLite data (`~/.pod/pod.sqlite`)

## CI (RWX)

- `.rwx/build.yml`: Full pipeline — clone → install → check → test → build
- `.rwx/format.yml`: Format-only
- `.rwx/test.yml`: Test-only

## Testing

- Framework: Vitest 4.1.7 with `pool: "forks"` (SQLite isolation)
- 66 unit test files in `tests/unit/`
- 1 smoke test in `tests/smoke/`
- Coverage via `c8`
- Run: `bun run test:run`
