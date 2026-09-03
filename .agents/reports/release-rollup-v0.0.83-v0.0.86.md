# Release Rollup: v0.0.83 → v0.0.86

**Date range:** 2026-07-11 → 2026-09-04
**Stack:** Bun 1.4.0 + Next.js 16.3.4 (TS strict, Turbopack) + open-sse (typed local fork) + SQLite + Redis (optional)
**Note:** No `v0.0.83`/`v0.0.84`/`v0.0.85` were ever tagged — those intermediate numbers never bumped `package.json`. The substantive work landed directly as **v0.0.86** (`dbc04745`). This rollup covers that single release plus the four follow-up dep-bump commits.

## Summary

Single substantive release plus a stack-modernization sweep:

- **v0.0.86** (`dbc04745`) — hang mitigations, Headroom, combo fusion
- **follow-ups** — Next.js 16.2 → 16.3.4, lucide-react 1.24 → 1.40, monaco-editor 0.55 → 0.56, undici 8.7 → 8.10, better-sqlite3 12 → 13, oxlint 1.73 → 1.81 + oxfmt 0.58 → 0.66, vitest 4.1.10 → 4.1.11, react/react-dom/react-is 19.2.7 → 19.2.8, jose 6.2.3 → 6.2.10, marked 18.0.6 → 18.0.11, open 11.0.0 → 11.0.2, recharts 3.9.2 → 3.10.1, shadcn 4.19.0 → 4.20.1, sonner 2.0.7 → 2.0.8, sql.js 1.14.1 → 1.14.2, uuid 14.0.1 → 14.0.2, zustand 5.0.14 → 5.0.15, @types/node 26.1.1 → 26.4.1, @types/react 19.2.17 → 19.2.18, @types/react-dom 19.2.3 → 19.2.7, postcss 8.5.16 → 8.5.28, @tailwindcss/postcss 4.3.2 → 4.3.3, tailwindcss 4.3.2 → 4.3.3, @xyflow/react 12.11.2 → 12.11.6

## Highlights (v0.0.86)

### Hang mitigations (prod 24 Aug)

- Skip RTK on bodies > 512 KiB
- Skip per-chunk `JSON.parse` on clean OpenAI passthrough SSE
- Cap 4 concurrent heavy streamed chats (≥ 256 KiB)
- Queue `usage_history` inserts (30-day retention)

### Zeabur k3s readiness

- Health Check was flapping Ready under combo load (dashboard SSR hit `GET /` with 1s timeout). Pointed at `/api/health` (timeout ≥ 5s). Docker `HEALTHCHECK` was already correct.

### Token Saver stack

- **Headroom** local spawn: loopback-only `start|stop|restart|status` (+ `extras` / `proxy`). No Docker/Zeabur sidecar. Compress path stays fail-open.
- Headroom HTTP client: `POST /v1/compress`, loopback/`headroom` host only.
- Combos Vision Adapter: global vision/audio pools that reorder combo members (and text-only single models) when the current user turn includes image or audio. Empty pool is a no-op.
- `X-Pod-Token-Saver: off` disables RTK + Headroom + Caveman + Ponytail.

### Combos

- Combo Fusion: per-combo Fallback / RR / Fusion (parallel panel + judge, N+1). Vision Adapter still filters the panel to capable models. TTS/image/search coerce fusion → fallback.
- Cloud combo: pass `comboStrategy` / `judgeModel` / `tuning` from machine settings into `handleComboChat`.

### OpenAI compatibility

- Standard CORS headers on `/v1/responses` for non-streaming requests.
- `400` on unsupported non-streaming usage.
- `POST /v1/responses/compact` for compact mode.

### Thinking copy suffix

- Provider Detail copies `alias/model(level)` from the existing Thinking Effort dropdown. Engine `thinkingUnified` strips the suffix and maps native thinking (Claude adaptive vs budget, Gemini, Codex ultra, etc.). Codex hyphen `-{effort}` still works after paren strip.

### Service worker

- Deploy-time SW versioning: `gen:sw-version` writes `/sw-version.json`; registrar registers `/sw.js?v=…` so each deploy gets an isolated cache namespace.
- SW shell-cache + deploy-regression test seams (`tests/unit/swShellCache.test.ts`, `tests/SW-TEST-SEAM.md`).

### Auth + rate-limit hardening

- `/api/monitoring/health*` made public reads (no API key), consistent with `/api/health`.
- Redis rate-limit isolation via `RATELIMIT_KEY_PREFIX` (`local:` / `pod:` / `pod-canary:`).
- Body cap 50 MB default (env `POD_MAX_REQUEST_BODY_BYTES`); chat routes use `POD_MAX_CHAT_BODY_BYTES`.

## Stack Modernization (follow-up commits)

- **Next.js 16.2 → 16.3.4** — async params/headers already in use; no code changes required. Two critical CVEs patched (Windows RCE + AVIF/libheif RCE), both defused in Pod (Linux deploy, `images.unoptimized: true`).
- **Turbopack tracing warnings silenced** — 9 `/* turbopackIgnore: true */` opt-outs on legitimate runtime filesystem/spawn calls (logs dir, Python candidate detection, pip list, cloudflared/tailscale binary spawn).
- **oxlint 1.79+ React rules** — opted out (`set-state-in-effect`, `set-state-in-render`, `no-deriving-state-in-effects`, `static-components`) to preserve current behavior; 7 pre-existing lint findings (3 immutability, 4 purity) fixed instead of opting out.
- **better-sqlite3 12 → 13** — N-API rebase, API stable, used in vitest Node path only.

## Verification

- `bun run check` — 0 warnings (post-oxlint 1.81 + 4 opt-outs)
- `bun run test:run` — 1523/1523 pass
- `bun run build` — 0 warnings/errors
- `GET /api/health` on canary — `{"ok":true}`
