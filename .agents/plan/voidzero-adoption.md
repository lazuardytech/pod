# Plan: voidzero.dev Tooling Adoption

Status: planning · v0.0.79 · Branch: canary

Adopt Oxlint (and conditionally Oxfmt) from the VoidZero toolchain. Skip Vite 8, Rolldown, and Vite+ — Next.js 16 + Turbopack owns the dev/build pipeline. Keep Bun as the runtime and package manager; do not switch to npm/pnpm.

## Why this is conservative

Pod's dev/build chain is owned by Next.js 16 (Turbopack). VoidZero's bundler-side tools (Vite 8, Rolldown, Vite+, tsdown) are inapplicable to a Next.js app. The two VoidZero tools that *are* applicable are:

- **Oxlint** — replaces the slow ESLint layer in `bun run check`.
- **Oxfmt** — kept as a future option; Biome already formats and Pod is happy with it.

Everything else in the VoidZero lineup is `skip` or `future` for Pod today.

## Not applicable

| Tool | Why it doesn't fit Pod |
|------|------------------------|
| Vite 8 | Next.js 16 runs its own dev server (`bun --bun next dev --turbopack`). Vite 8 is the wrong dev server for a Next app. |
| Rolldown (as primary bundler) | Vite 8 ships Rolldown; since Vite itself doesn't apply, neither does Rolldown as a *primary* bundler. Next.js 16's Turbopack is the bundler. |
| Vite+ (`vp` binary) | Unified CLI is meaningful only if you adopt Vite. We don't. |
| tsdown | Bundler for *standalone* JS libraries. Pod has no `packages/` workspace; there is no library to bundle. |

## Future option

If Pod ever extracts a reusable JS package (e.g. ships a public `pod-sdk` or splits `open-sse/` into a separate distributable), then **Rolldown + tsdown** become the natural build/dual-publish path:

- `tsdown` to produce ESM + CJS + d.ts from `open-sse/`.
- Oxlint + Vitest stay as the test/lint stack.

This plan does not extract anything; it only opens the door.

---

## Phase 0 — Baseline & benchmarks

**Goal**: Measure the current cost of `bun run check` so Phase 1 has a defensible win to point at.

**Tools adopted**: none.

**Changes**:
- Capture wall-clock time of `bun run check` and `bun x eslint .` (the slow part) on a clean tree. Repeat 3x, take median.
- Record counts: total JS files, lint findings, format diffs.
- Save to `.agents/reports/voidzero-phase0-baseline.md`.

**Compatibility check**: `bun run check && bun run test:run && bun run build` must pass before the snapshot is taken.

**Rollback**: nothing changed; the baseline report is additive.

**Effort**: small (≤1 hour).

**Entry criteria**: baseline report exists.
**Exit criteria**: `eslint` wall-clock ≥ 2s OR ≥ 2000 findings (otherwise there is nothing to win).

---

## Phase 1 — Adopt Oxlint for the ESLint layer

**Goal**: Replace the `bun x eslint .` step in `bun run check` with Oxlint, keeping Next.js's React rules available.

**Tools adopted**: Oxlint.

**Replaces**: `eslint@^9.39.4` + `eslint-config-next@^16.2.9` (the invocation in `package.json` line 12), and the rules in `eslint.config.mjs`.

**Why this is the right phase-1 pick**:
- Oxlint is 50-100x faster on JS lint — directly shortens the pre-push gate (`bun run check && bun run test:run && bun run build`).
- It is Prettier-compatible formatting-adjacent and ships ESLint-plugin compatibility.
- Pod's ESLint config is tiny (5 rules turned off, `next/core-web-vitals` as the only base). The rules Pod actually cares about — React Hooks (purity/refs/immutability/exhaustive-deps are *off* in `eslint.config.mjs`), `next/no-img-element` (off), `import/no-anonymous-default-export` (off), `@eslint/compat/no-unused-disable` (off) — are all off. The lint surface is small.
- Biome already handles format + a real rule set. Oxlint is a pure speed swap for the ESLint remainder.

**Changes**:
- `package.json`:
  - Add `devDependencies`: `oxlint` (latest, MIT).
  - Replace `"check": "biome format --write . && biome lint . && bun x eslint ."` with `"check": "biome format --write . && biome lint . && oxlint ."` (run as `bun x oxlint .` to stay inside the Bun-only invariant; AGENTS.md rule 1).
  - Keep `eslint` and `eslint-config-next` in `devDependencies` for now — removed in Phase 2 only after one full release cycle.
- Add `.oxlintrc.json` mirroring the active rules from `eslint.config.mjs`:
  - React Hooks subset (purity/refs/immutability/exhaustive-deps are *off* in current ESLint config — mirror that exactly).
  - `next/core-web-vitals` equivalent via `oxlint` `nextjs` plugin category (or skip if not 1:1; document the gap).
  - Ignore the same globs: `.next/**`, `out/**`, `build/**`, `coverage/**`, `node_modules/**`, `cloud/**`, `public/**`.
- Update `.agents/knowledge/03-dev-workflow.md` to reflect `bun x oxlint .` in the `bun run check` table.

**Compatibility check** (must all pass):
- `bun install` succeeds.
- `bun run check` runs Biome format + Biome lint + Oxlint, exits 0.
- `bun run test:run` — Vitest config in `vitest.config.mjs` is untouched; expect green.
- `bun run build` — Next.js 16 build path is untouched; expect green.
- Compare finding counts vs Phase 0 baseline; new findings are either true positives or accepted false positives. Document the delta.

**Rollback**:
- Revert the `check` script in `package.json` to the pre-Phase-1 string.
- Delete `.oxlintrc.json`.
- `bun install` is a no-op for the rollback unless the dev dep is also removed (leave it in this phase).

**Effort**: small (≤ half a day including baseline comparison and `.oxlintrc.json` authoring).

**Entry criteria**: Phase 0 baseline exists.
**Exit criteria**: `bun run check` wall-clock drops by ≥ 50% *and* finding count delta is documented *and* `bun run test:run && bun run build` stay green.

---

## Phase 2 — Strip ESLint

**Goal**: Remove the ESLint dependency tree now that Oxlint has run a full release cycle on canary.

**Tools adopted**: none new.

**Replaces**: `eslint`, `eslint-config-next` in `devDependencies`; `eslint.config.mjs` on disk.

**Changes**:
- `package.json`: drop `eslint` and `eslint-config-next` from `devDependencies`. Keep `oxlint`.
- Delete `eslint.config.mjs`.
- `bun install` to regenerate `bun.lock`.
- `.agents/knowledge/03-dev-workflow.md` final touch-up.

**Compatibility check**:
- `bun run check` (no `eslint` step, no `eslint-config-next` resolution) must still pass.
- `bun run test:run` and `bun run build` green.
- Zeabur deploy pipeline unaffected — `eslint` was a dev-only dep; production image doesn't carry it.

**Rollback**: restore `eslint.config.mjs` from git, re-add deps, change the `check` script back to `bun x eslint .`. `bun install` to refresh.

**Effort**: small (≤1 hour).

**Entry criteria**: one full canary release cycle on Phase 1.
**Exit criteria**: Oxlint-only `check` has been the only path for ≥ 1 release with no rollback.

---

## Phase 3 (optional) — Drop Biome format, adopt Oxfmt

**Goal**: Replace the Biome formatter with Oxfmt if Oxfmt's Prettier-compatible output is good enough for Pod.

**Tools adopted**: Oxfmt.

**Replaces**: the `biome format --write .` step inside `bun run check` (and the `format` script in `package.json`).

**Why this is *optional* and not Phase 1**:
- Biome format is fast and Pod is happy with it.
- Oxfmt's win is mostly the same 30x-faster story, but Biome is already 100x faster than Prettier — the marginal gain is small.
- The compatibility risk is real: any formatting drift between Biome and Oxfmt creates churn across `src/`, `open-sse/`, `tests/` (~thousands of files). Acceptable only if a script (`oxfmt --check` or Biome → Oxfmt one-shot) shows zero diffs.

**Changes**:
- `package.json`:
  - `scripts.format`: `"oxfmt --write ."` (run as `bun x oxfmt .`).
  - `scripts.check`: replace `biome format --write .` with `oxfmt --write .`. Keep `biome lint .` (Biome's linter stays).
- Add `oxfmt` to `devDependencies`.
- Update `biome.json` formatter block: `enabled: false` (linter only).
- Update `.agents/knowledge/03-dev-workflow.md`.

**Compatibility check**:
- Snapshot `biome format --check .` output before the switch. Run `oxfmt --check .` and diff.
- `bun run check`, `bun run test:run`, `bun run build` all green.
- A full `git diff --stat` showing only formatting churn (no logic) is the desired outcome; if it shows logic changes, abort.

**Rollback**:
- Revert `package.json` scripts, `biome.json` formatter block.
- Drop `oxfmt` from `devDependencies`. `bun install`.

**Effort**: medium (half-day including the dry-run diff and any rule tweaks).

**Entry criteria**: Phases 1 and 2 are stable. A `--check` diff between Biome and Oxfmt is ≤ N lines (decide N before starting; recommendation: 0).
**Exit criteria**: format-only churn is acceptable to maintainers *and* no logic diff appears in `git diff --stat`.

---

## Summary table

| Tool | Replaces | Status | Rationale |
|------|----------|--------|-----------|
| Oxlint | `eslint` + `eslint-config-next` in `bun run check` | **Adopt (Phases 1–2)** | Direct speed win on the pre-push gate; ESLint config is tiny. |
| Oxfmt | `biome format --write .` | **Adopt (Phase 3, optional)** | Marginal gain over Biome; only adopt if dry-run diff is clean. |
| Vite 8 | — | **Skip** | Next.js 16 owns the dev server. |
| Rolldown (primary bundler) | — | **Skip** | Turbopack is the bundler; Rolldown only ships inside Vite 8. |
| Vite+ (`vp` CLI) | — | **Skip** | No Vite. |
| tsdown | — | **Future** | Only relevant if Pod extracts a standalone JS library. |

## Cross-references

- `package.json` line 12: `check` script (the only place ESLint is invoked).
- `eslint.config.mjs`: the small, mostly-disabled ESLint config Oxlint replaces in Phase 1.
- `biome.json`: formatter + linter config; Phase 3 turns formatter off, linter stays.
- `vitest.config.mjs`: untouched by every phase; Vitest stays the test runner.
- `.agents/knowledge/03-dev-workflow.md`: the pre-push gate (`bun run check && bun run test:run && bun run build`) is the success criterion.
- `next.config.mjs`: unchanged; the Next/Turbopack boundary is out of scope.
