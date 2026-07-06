# VoidZero Adoption — Phase 0 Baseline

**Status**: snapshot for Phases 1–3 of `.agents/plan/voidzero-adoption.md`.
**Date**: 2026-06-26.
**Branch**: `canary`.
**Pod version**: 0.0.79.

## Environment

- Bun: `1.3.14`
- OS: `Darwin 25.5.0` (macOS 26)
- Arch: `arm64` (Apple Silicon)
- Working directory: `/Users/ezra/projects/lt/pod`
- Tree state: clean (no uncommitted or untracked changes at the time of capture).

## Wall-clock medians (3 runs each)

Wall-clock measured externally with `date +%s.%N` around the command, in seconds.

| Command                        | Runs (s)                 | Median       |
| ------------------------------ | ------------------------ | ------------ |
| `bun run check`                | 12.872 / 12.476 / 13.064 | **12.872 s** |
| `bun x eslint .`               | 13.273 / 12.790 / 12.355 | **12.790 s** |
| `bun x biome lint .`           | 0.267 / 0.182 / 0.183    | **0.183 s**  |
| `bun x biome format --write .` | 0.181 / 0.177 / 0.179    | **0.179 s**  |

The `bun run check` budget is **~99% ESLint**. Biome (format + lint) is sub-second; Oxlint has direct runway here.

## File counts

JS/JSX files in the two application source trees, as called out in the plan:

| Path         | .js + .jsx |
| ------------ | ---------- |
| `src/`       | 360        |
| `open-sse/`  | 155        |
| **Subtotal** | **515**    |

Reference numbers (not part of the plan's headline count, included for context):

| Path                                | .js + .jsx |
| ----------------------------------- | ---------- |
| `cloud/`                            | 699        |
| `tests/`                            | 294        |
| Project-wide (excl. `node_modules`) | 4082       |

`bun x eslint .` actually scans **614 files** (per `--format json` output): `src/` 362, `open-sse/` 155, `tests/` 75, `cloud/` 17, `public/` 1, and 4 loose files. ESLint's own file selection is therefore narrower than the on-disk JS/JSX total (it skips `next.config.mjs`, `eslint.config.mjs`, `biome.json`, fixtures, JSON/`.mjs`/data files, etc.).

## ESLint findings

Captured via `bun x eslint . --format json` (148,451 bytes). Parsed in Node:

- **Total files scanned**: 614
- **Files with at least one finding**: 0
- **Total findings**: **0**

`eslint` exits 0; `bun run check` exits 0.

## Verification gate (before the snapshot)

| Command            | Result                                                                            |
| ------------------ | --------------------------------------------------------------------------------- |
| `bun run check`    | exit 0 (13.953 s on the verification run)                                         |
| `bun run test:run` | exit 0 — 70 test files passed, 3 skipped, 1338 tests passed, 19 skipped (17.52 s) |
| `bun run build`    | exit 0 — Next.js 16 production build (10.898 s)                                   |

All three pass. Baseline is taken on a known-good tree.

## Plan exit-gate check

Phase 0 exit criterion (from the plan):

> `eslint` wall-clock ≥ 2s **OR** ≥ 2000 findings.

| Signal                   | Observed     | Pass?       |
| ------------------------ | ------------ | ----------- |
| `eslint` wall-clock ≥ 2s | **12.790 s** | YES         |
| Findings ≥ 2000          | 0            | NO (but OR) |

**Phase 0 exits green on the wall-clock half of the OR.** ESLint is the dominant cost of `bun run check` (~12.8 s of ~12.9 s). Replacing it with Oxlint is the meaningful change in Phase 1.

## Notes for Phase 1

- The current `eslint.config.mjs` extends only `eslint-config-next/core-web-vitals` and turns 8 rules **off**; no rules are explicitly enabled. The active rule surface is whatever `next/core-web-vitals` enables minus those 8. Oxlint's rule set is different in shape; the `.oxlintrc.json` should aim for parity, not 1:1 rule IDs.
- The plan listed `cloud/**` and `public/**` as ignore globs. The current `eslint.config.mjs` only ignores `.next/**`, `out/**`, `build/**`, `next-env.d.ts`, `coverage/**`. Per the user instruction, Phase 1 mirrors the **actual** `eslint.config.mjs` ignore list — not the plan's slightly-stale list.
- `eslint` and `eslint-config-next` stay in `devDependencies` through Phase 1; Phase 2 strips them after a release cycle.
