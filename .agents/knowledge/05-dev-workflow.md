# Dev Workflow

## Core Commands

```bash
bun install
bun run dev
bun run format
bun run check
bun run test:run
bun run build
```

## Workflow Rules

1. Use Bun only.
2. Update docs from live code, not from stale audits.
3. Prefer small, verifiable changes.
4. Verify routing, auth, and stream behavior after non-trivial changes.

## Before Push

Run:

```bash
bun run check
bun run test:run
bun run build
```
