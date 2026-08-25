# Dev Workflow

## Commands

| Command                        | What                                                                                                      |
| ------------------------------ | --------------------------------------------------------------------------------------------------------- |
| `bun install`                  | Install dependencies (never npm/pnpm)                                                                     |
| `bun run dev`                  | Start dev server on :20128 (Next.js Turbopack)                                                            |
| `bun run build`                | Production build (standalone output)                                                                      |
| `bun run start`                | Start production server                                                                                   |
| `bun run format`               | Oxfmt format                                                                                              |
| `bun run check`                | `scripts/check-open-sse-ts-nocheck.ts` then lockfile oxfmt + oxlint `--deny-warnings` + tsc (not `bun x`) |
| `bun scripts/sqlite-backup.ts` | `VACUUM INTO` SQLite snapshot (`$DATA_DIR/backups/`)                                                      |
| `bun run lint`                 | Oxlint linting                                                                                            |
| `bun run test:run`             | Vitest (verbose). Default include excludes `tests/live/**` (0 skip)                                       |
| `bun run test:live`            | Optional live harnesses (`AG_CACHE_TEST=1` / `RUN_E2E=1`)                                                 |
| `bun run test:coverage`        | Vitest with coverage                                                                                      |

## Pre-Push Verification

```bash
bun run check && bun run test:run && bun run build
```

All three must pass before pushing. No exceptions.

SW shell-cache regression (when touching `public/sw.js` / registrar):

```bash
bun x vitest run tests/unit/swShellCache.test.ts
```

## Workflow Rules

1. **Update docs from live code** — documentation reflects current codebase, not intentions
2. **Small verifiable changes** — each change should be independently testable
3. **Verify routing/auth/stream** — test the specific path you changed
4. **After translator changes** — verify thinking content does not leak into content field

## Testing

- Tests live in `tests/` (unit + smoke). Live Google/localhost harnesses are `tests/live/` (`bun run test:live`); they are excluded from `bun run test:run`.
- Vitest with verbose output. Default `test:run` must report 0 skipped.
- Coverage via `@vitest/coverage-v8`
- Run specific tests: `bun run test:run -- <pattern>`
- `test:run` needs Node ≥ 22.18 on PATH (not bun). See AGENTS.md Cursor Cloud notes.

## Git

- `canary` is the active development branch
- `main` is the stable/release branch
- Conventional Commits format

## Cursor Cloud

- Workspace / Cloud environment default branch for development: **`canary`**
- Install helper: `scripts/cloud-dev-install.sh`
- Start helper: `scripts/cloud-dev-start.sh` (needs `JWT_SECRET` + `API_KEY_SECRET` from Secrets)
- Ponytail skills: `.agents/skills/ponytail*` — `/ponytail lite|full|ultra`
- See AGENTS.md → **Cursor Cloud specific instructions**
