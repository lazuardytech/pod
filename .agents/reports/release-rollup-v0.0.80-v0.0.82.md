# Release Rollup: v0.0.80 → v0.0.82

**Date range:** 2026-07-07 → 2026-07-11 (v0.0.80, v0.0.81, v0.0.82)
**Stack:** Bun + Next.js 16 (TS strict) + open-sse (typed local fork) + SQLite + Redis (optional)
**Note:** No per-version rollup existed for this gap; this consolidates v0.0.80–v0.0.82. **Correction (2026-08-20):** `open-sse/` is TypeScript and included in root `tsc` — the “frozen as JS” line in the summary below is historical.

## Summary

Three consecutive hardening releases focused on OpenAI/Anthropic compatibility correctness, streaming/body robustness (client-disconnect handling, body-size cap, large-body latency), Redis rate-limit isolation, and a full toolchain swap to the VoidZero stack (oxfmt/oxlint, Biome/ESLint removed). The JS→TS migration is complete; `open-sse/` is TypeScript and included in root `tsc` (the older “frozen as JS” wording in this summary is historical and superseded — see the correction at the top of this file).

---

## OpenAI / Anthropic compatibility hardening

- Responses API shape correctness and error-shape compliance on `/v1/messages` (Anthropic error format returned from catch blocks).
- `files` DELETE now returns 404 (not 500) for missing entries.
- Rate-limit headers emitted on compatible responses.
- CORS enabled on `/v1/responses` for non-streaming; malformed requests return 400.
- Topology-leak cleanup: responses no longer expose internal topology/host detail.

## Streaming & body robustness

- `AbortError` at `node:_http_server` (client disconnect) classified as `[ClientDisconnect]`, not `[FATAL]`; global rejection/exception handlers dedupe log spam.
- SSE stream wrappers use `controller.close()` (not `controller.error(err)`) on reader abort; `chatCore.js` filters `AbortError` and closes cleanly.
- Hard body cap raised 10MB → 50MB, env-tunable via `POD_MAX_REQUEST_BODY_BYTES` / `POD_MAX_CHAT_BODY_BYTES`.
- Canary 9–15s large-body latency fixed: `src/sse/handlers/chat.ts` uses `readBodyTextStream()` (chunked read with explicit size cap) instead of `request.text()`; per-request timing instrumentation added (`t_read`, `t_parse`, `t_bypass`).
- Abort-safe parsing applied to 6 sibling routes (`imageGeneration`, `tts`, `fetch`, `embeddings`, `search`, `pricing/sync`).

## Rate limiting & Redis

- `RATELIMIT_KEY_PREFIX` env var isolates canary/production Redis namespaces (shared-keyspace risk fixed).
- Per-op timeout (`RATELIMIT_REDIS_TIMEOUT_MS`, default 1s) prevents stalled Redis from blocking requests.
- Non-blocking Redis startup: server no longer blocks on Redis init failure in `register()`.

## Operations

- Service-worker cold-start optimization for Zeabur.
- Offline cache added to the combos page (instant load on revisit).
- Lint hardening: residual `eqeqeq` warnings resolved across `src/`; CodeQL taint fixes applied.
- HEALTHCHECK port fix, SSE counter leak fix, Redis leak fix, `instrumentation.ts` init-order fix, dead-code cleanup.
- Root `/` redirects to `/endpoint` (not the removed `/dashboard`).

## Tooling

- VoidZero adoption complete: **oxfmt** (format) + **oxlint** (lint) + **tsc** (typecheck) + **vitest** (test).
- **Biome and ESLint removed.** Verify gate: `bun run check` (oxfmt + oxlint + `tsc --noEmit`), `bun run test:run`, `bun run build` (NODE_ENV=production next build).
- JS→TS migration complete; repo is TypeScript strict. `open-sse/` frozen as JS by design.

---

## Carry-over to `Unreleased`

- Removed redundant `controller.close()` in `open-sse/handlers/chatCore.js` finally block (already closed in success path).
