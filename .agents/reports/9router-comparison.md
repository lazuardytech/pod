# Research: `decolua/9router` vs local `pod` (v0.0.44)

> **Date:** 2026-05-26
> **Author:** research subagent
> **Status:** ⚠️ **Partial — network access unavailable in this session**

## Summary

This subagent was asked to compare `github.com/decolua/9router` against the local
`pod` project at `/Users/ezra/projects/lt/pod` (baseline `v0.0.44`). The
comparison could not be completed end-to-end because **no web/network tool
(`web_search`, `web_fetch`, `curl`, shell) is available in this session** — only
`read` and `write` against the local filesystem. Fabricating commit SHAs,
diffs, or "findings" from a repo that was not actually fetched would be worse
than no report, so this document instead captures:

1. The pod-side baseline (versions, features, conventions, gotchas) needed to
   run the diff.
2. Everything currently known locally about the pod ↔ 9router relationship.
3. A concrete, copy-paste plan for finishing the comparison in a tool-equipped
   session (or by the user directly via `gh` / `curl`).

## What is known locally about the pod ↔ 9router relationship

From `/Users/ezra/projects/lt/pod/.agents/knowledge/09-fork-status.md` and
`01-overview.md`:

- Pod is an intentional **rebrand and divergence** from `9router`. The first
  pod release (`v0.0.1`) is described as: *"Rebranding 9router → Pod, bun
  migration, route restructure, Linear design system"*.
- Pod's `package.json` is now `"name": "pod"`, version `0.0.44` (per local
  `package.json`), Docker image `lazuardytech/pod`, GitHub
  `lazuardytech/pod`, branch `main`, data dir `~/.pod/`, SQLite file
  `pod.sqlite`.
- `git remote -v` (per `09-fork-status.md`) shows only `origin =
  lazuardytech/pod`. **No `upstream` remote is configured**, and the upstream
  is documented as "intentionally diverged" along these axes:
  1. bun-first build/CI (no npm/pnpm).
  2. Docker publish to Docker Hub `lazuardytech/pod`.
  3. Memory/cache/rate-limit features integrated into API + dashboard.
  4. Linear design system (dark/light theme).
  5. Internal contributor docs (`AGENTS.md`, `.agents/*`) maintained in-repo.
  6. Version reset to `v0.0.1` as new identity baseline.
- `decolua/9router` is **not the original upstream pod was forked from**
  according to local docs — local docs only refer to "9router" without
  attributing it to an organization. Whether `decolua/9router` is the same
  upstream, a sibling fork, or an unrelated fork of 9router is **not
  verifiable from local files alone**. This needs to be confirmed by
  inspecting the remote.

## Pod baseline used for the comparison

Captured here so the diff can be run without re-reading the codebase.

### Version state

- `package.json` → `"version": "0.0.44"`, `"name": "pod"`,
  `"packageManager": "bun@1.3.14"`.
- `src/shared/constants/config.js` → `APP_CONFIG.displayVersion = "0.0.44"`.
- `.agents/knowledge/09-fork-status.md` last-documented release: **v0.0.31**
  (the knowledge file is stale by ~13 patch releases relative to
  `package.json`). Anything newer than `v0.0.31` in the changelog table is
  *not* yet captured in `09-fork-status.md`. This is itself a follow-up.

### Tech stack (from `package.json`)

- Runtime: Next.js `^16.2.6`, React `19.2.6`, bun `1.3.14`.
- Persistence: `sql.js` + `better-sqlite3` (devDeps), `bun:sqlite` in prod,
  `lowdb` (legacy), `proper-lockfile`.
- UI: Tailwind v4 (`@tailwindcss/postcss`), `@dnd-kit/*`,
  `@monaco-editor/react`, `@xyflow/react`, `recharts`, `vaul`, `sonner`,
  `zustand`, `react-day-picker`, `marked`.
- Net: `undici`, `socks-proxy-agent`, `http-proxy-middleware`, `express`
  (legacy), `selfsigned`, `node-forge`, `jose`, `bcryptjs`, `node-machine-id`.
- Dev: `@biomejs/biome ^2.4.15`, `eslint ^9.39.4`, `eslint-config-next`,
  `vitest ^4.1.7`, `vite-tsconfig-paths`.

### Architectural invariants relevant to any merge

These come from `AGENTS.md` and `.agents/knowledge/*` and any incoming
9router change must be checked against them before adoption:

1. **bun only** — never npm/pnpm.
2. Internal naming stays `pod` (package, DB filename, data dir, Docker image).
3. `open-sse/` is **local source**, resolved via `jsconfig.json` aliases —
   never converted to an npm dependency.
4. Persistence goes through `src/lib/localDb.js` and
   `src/lib/sqlite/connection.js` facades.
5. No browser `confirm()` — always `<ConfirmModal>`.
6. No `/dashboard` prefix on routes.
7. Version bumps must touch both `package.json` AND
   `src/shared/constants/config.js` `displayVersion`.
8. Header action buttons go through `src/store/headerActionStore.js`.
9. `GET /v1/models`, `/v1/models/[kind]`, `/v1beta/models` enforce API key
   auth when `requireApiKey=true`.
10. SSE endpoints follow the `open-sse` stream-helper pattern and **must
    attach `request.signal.addEventListener("abort", cleanup)`** (root cause
    of the v0.0.13 1.2GB leak).
11. `text-primary-fg` for text on `bg-primary` (theme-flip safe).
12. Provider node rename is custom-only (`openai-compatible-*`,
    `anthropic-compatible-*`, `custom-embedding-*`); built-in IDs are
    hardcoded.
13. Streaming requests **are** cached. Don't re-add a `stream: true` exclusion.
    `clearInFlight` runs unconditionally on all 3 response paths.
14. No `--smol` flag in Dockerfile — memory bounded via cache env vars.
15. `modelLockCount_${model}` is a flat field used as backoff multiplier; not
    cleared on non-success paths.
16. models.dev pricing sync runs on boot via `startPeriodicSync()`. Resolution
    order: user overrides → models.dev → static fallback.
17. Vertex AI request body must never carry `stream` — controlled by URL
    suffix and `?alt=sse`. Both `chatCore.js` and `openaiToVertexRequest`
    guard this.
18. Tunnel enable's `fetchData()` call after `pingTunnelHealth()` is
    non-fatal; raw browser network errors must be sanitized.
19. `cloud/src/handlers/testClaude.js` stub must exist (returns 410). Static
    import; missing it breaks worker deploy.
20. Semantic cache signature includes `memoryOwnerId`; temperature `null`
    and `1` normalize identically.
21. SQLite cache TTL uses `strftime('%Y-%m-%dT%H:%M:%SZ', 'now')`, never
    `datetime('now')` (silent ISO 8601 vs space-separator mismatch was the
    root cause of v0.0.30 cache misses).

### Known recent feature surface (v0.0.17 → v0.0.31)

From `01-overview.md` / `09-fork-status.md`. Anything 9router has that lands in
this list is **already present in pod**:

- Drag-to-reorder combos + provider connections (`@dnd-kit`),
  `sort_order` SQLite migration, multi-account custom providers (v0.0.17).
- All 23 CodeQL alerts fixed: SSRF, insecure randomness, XSS, stack trace,
  workflow permissions (v0.0.18).
- Quota disabled-model filter, `h-1.5` progress bars, health page improvements
  (v0.0.19).
- Semantic cache hit-rate fix via memory injection signature, configurable
  minimum lockout, quota toolbar, logs `h-[70vh]`, health lockout clear
  button (v0.0.20).
- Minimum-lockout guard fixes (skipped longer cooldowns, `resetsAtMs` path)
  (v0.0.21).
- Semantic cache temperature/top_p normalization,
  `approxRequestBytes` content-block fix (v0.0.22).
- `PRAGMA integrity_check` cached 5min, health stream 10s interval,
  request-logs stream fixed 2s poll, +23 SSE hotpath tests (v0.0.23).
- API key `last_access_at` tracked on every authed request, shown in
  `/endpoint`; Est. Cost rounded up to 2 decimals (v0.0.24).
- models.dev pricing sync — `src/lib/modelsDevSync.js`, periodic sync on boot,
  "Sync Now" in `/settings`, `GET/POST /api/pricing/sync` (v0.0.25).
- Model lock count tracking (`modelLockCount_${model}` flat field, 1x/2x/3x
  backoff); Vertex AI `stream` field guard; `requestTooLargeForCache` removed
  (v0.0.26).
- Bug fixes: tunnel pings `tunnelUrl` not `publicUrl`; `/providers`
  "Connected Only" `noAuth` fix; `/media-providers` grid from `allProviders`;
  `/quota` disabled hidden + toolbar state to localStorage; `/usage` Details
  observability toggle reads both fields (v0.0.27).
- UI cleanup: drag handles act as priority, `/health` Model Lockout below
  Provider Health, `/combos` "Test All", `/logs` Proxy Logs Actions fixed
  width, `/quota` white active style, Melma removed from `APIKEY_PROVIDERS`
  (v0.0.28).
- Tunnel enable error sanitization + non-fatal `fetchData()`; cloud worker
  `testClaude.js` 410 stub; Vertex stream guard tests (26); console logs
  scroll-to-bottom on `init`; `/quota` hide-disabled toggle fix; README env
  vars (`INITIAL_PASSWORD`, `BASE_URL`, `CLOUD_URL`); 533 tests / 31 files
  (v0.0.29).
- Semantic cache fixes (SQLite TTL `strftime` ISO 8601, `memoryOwnerId` in
  signature, temperature `null`→`1` normalization, 512KB response limit,
  unconditional `clearInFlight`); memory strategy fixes
  (`"recent"`→`"exact"` alias, `/api/memory` in `PROTECTED_API_PATHS`); 711
  tests / 37 files (v0.0.31).

### Knowledge gap on pod's own recent state

`09-fork-status.md` documents up to **v0.0.31**. `package.json` is at
**v0.0.44**. The 13 intervening patch versions (v0.0.32 → v0.0.44) are
**not yet captured in `.agents/knowledge/`**. Anything 9router introduces
in that window may already be present in pod and undocumented here. A
proper diff must read pod's actual `git log` for that range, not just the
knowledge files.

## Findings

1. **Cannot reach `github.com/decolua/9router` from this session** — no
   `web_search`, `web_fetch`, or shell tool is exposed. The available tool
   surface is `read` and `write` only. Per the operating rule "do not
   present assumptions as facts," I will not synthesize commit-level
   findings without actually reading the remote.
2. **Pod ≠ 9router internally** — pod renames everything (`pod` package,
   `~/.pod/pod.sqlite`, `lazuardytech/pod` Docker image) and has explicit
   non-negotiable rules against re-introducing 9router naming. Any
   wholesale upstream merge is off-limits; only individual changes can be
   adopted.
3. **No `upstream` git remote is configured locally** (per
   `.agents/knowledge/09-fork-status.md`). Adding one would be the
   cleanest path to a real diff.
4. **Pod is 13 patch releases ahead of its own knowledge docs**
   (`v0.0.31` documented vs. `v0.0.44` in `package.json`). The diff must
   account for this — many "9router has X" hits may already be in pod
   `v0.0.32`–`v0.0.44`, just undocumented in `.agents/knowledge/`.
5. **Pod is hardened in places upstream may not be** — v0.0.18 fixed all
   23 CodeQL alerts (SSRF, insecure randomness, XSS, stack-trace leaks,
   workflow permissions); v0.0.13 fixed a 1.2GB SSE/LRU/SQLite leak;
   v0.0.31 fixed the silent ISO-8601-vs-space SQLite TTL bug. Any 9router
   changes in these areas should be checked against pod's existing fixes
   before adoption to avoid regressing.

## Sources

- Kept: `/Users/ezra/projects/lt/pod/AGENTS.md` — non-negotiable rules
  (current).
- Kept: `/Users/ezra/projects/lt/pod/package.json` — current version
  `0.0.44`, dep manifest.
- Kept: `/Users/ezra/projects/lt/pod/src/shared/constants/config.js` —
  `displayVersion` `"0.0.44"`.
- Kept: `/Users/ezra/projects/lt/pod/.agents/knowledge/01-overview.md` —
  per-version feature log up to v0.0.14 + v0.0.31 in adjacent file.
- Kept: `/Users/ezra/projects/lt/pod/.agents/knowledge/02-architecture.md` —
  request-path, SSE, cache, memory invariants.
- Kept: `/Users/ezra/projects/lt/pod/.agents/knowledge/03-providers-and-routing.md`
  — provider config sources, fallback layers, executors.
- Kept: `/Users/ezra/projects/lt/pod/.agents/knowledge/04-api-surface.md` —
  full public/dashboard API list, SSE endpoint list.
- Kept: `/Users/ezra/projects/lt/pod/.agents/knowledge/05-dev-workflow.md` —
  bun commands, CI workflows, Docker facts.
- Kept: `/Users/ezra/projects/lt/pod/.agents/knowledge/06-conventions.md` —
  UI conventions, design tokens, alias rules.
- Kept: `/Users/ezra/projects/lt/pod/.agents/knowledge/07-gotchas.md` —
  54-item gotchas list (cache TTL, SSE abort, Vertex stream guard,
  cloud stub, etc.).
- Kept: `/Users/ezra/projects/lt/pod/.agents/knowledge/09-fork-status.md`
  — release table v0.0.1 → v0.0.31, divergence notes, no `upstream` remote.
- Dropped: `github.com/decolua/9router` README, `package.json`,
  `/commits/main`, releases, branches — **could not be fetched from this
  session** (no network tool).
- Dropped: `api.github.com/repos/decolua/9router/commits` — same reason.

## Gaps

The entire 9router-side of the diff is missing. Specifically:

- 9router's current version / latest release tag.
- 9router's recent commit list (last 30–90 days) on `main`.
- 9router's `package.json` (deps, runtime, scripts) for stack drift
  vs. pod.
- 9router's `README.md` and `cloud/` parity (whether the v0.0.29
  `testClaude.js` 410 stub fix is needed there too).
- Whether 9router carries CodeQL/SSRF/XSS fixes equivalent to pod v0.0.18.
- Whether 9router has the v0.0.13 SSE-abort/LRU memory fixes, the v0.0.20
  semantic-cache memory-injection signature fix, the v0.0.31 SQLite TTL
  `strftime` fix.
- Whether 9router introduced provider/translator features pod hasn't
  picked up (e.g. new providers post-Blackbox/MiniMax, new TTS/STT,
  new translators).
- Pod's own v0.0.32 → v0.0.44 changelog (gap in `.agents/knowledge/`).

## Suggested next steps (ordered)

These are the concrete commands to finish this task in a tool-equipped
session. Each is intentionally minimal so it can be re-run by a follow-up
worker without re-reading this whole report.

1. **Backfill pod's own recent history** so the diff has a real baseline:
   ```bash
   cd ~/projects/lt/pod
   git log --oneline --no-decorate v0.0.31..HEAD > /tmp/pod-recent.txt
   git tag --list 'v0.0.3[2-9]' 'v0.0.4*'
   ```
   Update `.agents/knowledge/09-fork-status.md` with the v0.0.32 → v0.0.44
   rows before doing the cross-repo diff.

2. **Inspect 9router from outside the repo (read-only)**:
   ```bash
   # repo overview
   gh repo view decolua/9router --json name,description,defaultBranchRef,updatedAt,pushedAt,stargazerCount

   # latest release / tag state
   gh release list --repo decolua/9router --limit 10
   gh api /repos/decolua/9router/tags?per_page=20

   # recent commits on default branch (last 90 days)
   gh api "/repos/decolua/9router/commits?since=$(date -u -v-90d +%Y-%m-%dT%H:%M:%SZ)&per_page=100" \
     --jq '.[] | {sha: .sha[0:7], date: .commit.author.date, msg: .commit.message | split("\n")[0]}'

   # package.json + README for stack drift
   curl -fsSL https://raw.githubusercontent.com/decolua/9router/main/package.json
   curl -fsSL https://raw.githubusercontent.com/decolua/9router/main/README.md
   ```

3. **Optionally add a read-only `upstream` remote** (no fetch yet) to make
   per-file diffing trivial:
   ```bash
   cd ~/projects/lt/pod
   git remote add 9router https://github.com/decolua/9router.git
   git fetch 9router --no-tags --depth=200
   # for any file you suspect is touched:
   git diff --stat 9router/main -- src/ open-sse/ cloud/
   git log --oneline 9router/main --since=90.days
   ```
   Note: `09-fork-status.md` documents that no upstream remote exists
   intentionally. Adding one is fine for diffing as long as it's never
   used for `git pull` / `git merge` — pod is intentionally diverged.

4. **Triage 9router commits against the categories below.** For each
   commit decide:
   - already-present? (grep pod's tree)
   - clashes with a non-negotiable rule? (`AGENTS.md` 1–21,
     `07-gotchas.md` 1–54)
   - net win? (security, perf, correctness, UX)
   - effort to port given pod's bun/Linear/headerActionStore stack?

## Categorized report (template — to be filled by the follow-up worker)

> Until step 2 above runs, the buckets below are **structurally empty**.
> The schema is provided so the next pass only has to drop entries in.

### Adoptable now (low-risk, clearly beneficial)
| Commit (sha) | Files | Why pod wants it | Verification |
|---|---|---|---|
| _tbd_ | _tbd_ | _tbd_ | `bun run check` + `bun run test:run` |

Suggested filters when triaging:
- Pure bug fixes in `open-sse/translator/*`, `open-sse/executors/*` (engine
  parity is the cheapest win).
- Security patches that don't already match pod's v0.0.18 CodeQL fixes.
- Provider config additions in `open-sse/config/providers.js` /
  `providerModels.js` for providers pod doesn't yet support.

### Adoptable with caveats (worth doing, needs adaptation)
| Commit | Caveat | Adaptation needed |
|---|---|---|
| _tbd_ | _tbd_ | _tbd_ |

Common caveats to expect:
- Anything touching the dashboard UI must be re-skinned to the **Linear
  design system** (CSS vars, `text-primary-fg` rule, `<Button>` /
  `<Badge>` / `<SegmentedControl>` / `<ConfirmModal>` components).
- Anything touching SSE must add the
  `request.signal.addEventListener("abort", cleanup)` pattern (gotcha 32).
- Anything touching cache must preserve `memoryOwnerId` in
  `generateSignature`, `strftime` ISO 8601 TTL, unconditional
  `clearInFlight` (gotchas 52–54).
- Anything touching Vertex must skip `stream` body injection (gotcha 44).
- Header action buttons must be registered via `headerActionStore`, not
  rendered inline.
- Routes must not use a `/dashboard` prefix.

### Skip (not relevant or already present)
| Commit / area | Reason |
|---|---|
| _tbd_ | _tbd_ |

Pre-classified skips (already present in pod, do not re-port):
- 9router pricing sync from any source — pod has models.dev sync at
  `src/lib/modelsDevSync.js` with override → models.dev → static fallback
  (v0.0.25).
- 9router model lockout features that don't already match pod's
  `modelLockCount_${model}` flat-field backoff (v0.0.26).
- 9router rebrand-or-naming changes that touch `pod` / `~/.pod/` /
  `lazuardytech/pod` (rule 2 — internal naming stays `pod`).
- 9router moves to `npm`/`pnpm` (rule 1 — bun only).
- 9router additions of `--smol` to Dockerfile (rule 14 — removed
  intentionally).
- 9router `MITM_BYPASS_HOSTS` / `resolveRealIP` / `createBypassRequest`
  (gotcha 15 — removed in v0.0.4, do not re-add).
- 9router additions of a `/dashboard` prefix to routes (rule 6).
- 9router `bg-primary text-white` / `text-black` patterns (rule 11).

### Diverged (where pod and 9router took different paths)
| Area | Pod's path | 9router's path | Reconcile? |
|---|---|---|---|
| Runtime | bun 1.3.14 + `bun:sqlite` (prod) / `better-sqlite3` (tests only) | _tbd_ | Pod stays bun (rule 1) |
| Naming | `pod`, `~/.pod/`, `lazuardytech/pod` Docker | `9router` | Pod stays `pod` (rule 2) |
| Engine | `open-sse/` as **local source** via `jsconfig.json` aliases | _tbd_ | Pod stays local source (rule 3) |
| Design system | Linear (dark/light, `text-primary-fg`, CSS vars) | _tbd_ | Pod stays Linear |
| Header actions | `headerActionStore` Zustand registration | _tbd_ | Pod stays headerActionStore |
| Routes | top-level (no `/dashboard`) | _tbd_ | Pod stays top-level (rule 6) |
| Confirm dialogs | `<ConfirmModal>` only | _tbd_ | Pod never uses `confirm()` (rule 5) |
| Cache TTL | SQLite ISO 8601 + `strftime` | _tbd_ | Pod stays `strftime` (gotcha 52) |
| Cache signature | includes `memoryOwnerId`, normalizes temp `null`↔`1` | _tbd_ | Pod stays this way (gotcha 53) |
| SSE | mandatory `signal.addEventListener("abort", cleanup)` | _tbd_ | Pod stays this way (gotcha 32) |
| Memory store | `LRUCache` 500 entries / 4MB / 300s TTL | _tbd_ | Pod stays bounded (v0.0.13) |
| Docker | `bun /app/server.js`, no `--smol`, cache env-var bounded | _tbd_ | Pod stays no-`--smol` (rule 14) |
| Vertex stream | URL suffix + `?alt=sse`, never body field | _tbd_ | Pod stays guarded (rule 17) |

## Supervisor coordination

Reason: `need_decision`. The task as written ("be concrete: cite commit SHAs,
file paths, line numbers") cannot be honored from this session because no
network tool is available. Two reasonable next moves, in order of preference:

1. **Re-dispatch this task to a subagent that has `web_fetch` / `web_search`
   (or shell with `gh` and `curl`)**, and feed it this report as a starting
   baseline. The "Suggested next steps" section is copy-paste runnable. The
   "Categorized report (template)" section is structured to be filled in
   without rewriting prose.
2. **Have the user run the three blocks under "Suggested next steps"
   locally** and paste the output back. The same template can then be filled
   in this session with `read`/`write` only.

If neither is possible, the most useful pod-side prep work the user can do
right now without 9router data is:

- Fill the v0.0.32 → v0.0.44 row gap in
  `.agents/knowledge/09-fork-status.md` from `git log v0.0.31..HEAD` and
  `git tag --list 'v0.0.3*' 'v0.0.4*'`. That alone closes the largest known
  blind spot in the comparison.
