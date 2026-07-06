# VoidZero Migration Baseline

**Date**: 2026-07-06 | **Branch**: canary

## Times

| Command | Wall clock | User | System |
|---------|-----------|------|--------|
| `bun run check` | 2.68s | 4.58s | 0.91s |
| `bun run test:run` | 15.76s | 10.06s | 1.77s |
| `bun run build` | 18.35s | 42.59s | 6.68s |

## Pre-Migration Tooling

- Biome 2.4.16 (format + lint)
- Oxlint 1.71.0
- TypeScript ^5.6
- Vitest ^4.1.8

## Post-Migration Tooling

- Oxfmt 0.57.0 (format)
- Oxlint 1.71.0 (lint)
- TypeScript ^5.6 (type-check via tsc --noEmit)
- Vitest ^4.1.8 (test)

## Visible Changes

- `bun run check`: Biome format + Biome lint + oxlint + tsc -> Oxfmt + Oxlint + tsc
- Biome dependency removed, biome.json deleted
- `.oxlintrc.json` added with nextjs/typescript/react plugin rules
