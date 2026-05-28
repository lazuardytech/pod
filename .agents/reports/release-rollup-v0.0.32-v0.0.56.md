# Release Rollup — v0.0.32 → v0.0.56

> **Date:** 2026-05-28
> **Range:** 25 versions (v0.0.32 published 2026-05-13 → v0.0.56 published 2026-05-28)
> **Test growth:** 711 (v0.0.31) → 1224 (v0.0.56) — +513 tests
> **Status:** main @ b28279c, 0 open CodeQL alerts, 0 Dependabot, 0 secret-scanning

This is the canonical 1-paragraph-per-version arc summary. For full per-release detail
see `.agents/knowledge/09-fork-status.md`.

---

## Q1: Foundation hardening (v0.0.32 → v0.0.46)

**v0.0.32** — Fix Codex 502 invalid JSON response. Remove the `disableCodexStreaming` workaround that masked the bug.

**v0.0.33** — `/quota` double-click expand bug squashed. Add Last Request At column. Fix toggle state hydration from localStorage.

**v0.0.34–v0.0.35** — Internal/intermediate releases, no published changelog.

**v0.0.36** — UI polish pass: rename "Providers" → "LLM Providers", breadcrumb fixes, `/media-providers` placeholder centring, ReactFlow viewport persists to sessionStorage.

**v0.0.37–v0.0.41** — Internal/intermediate.

**v0.0.42** — Tunnel enable's "Unable to connect" error fixed (3 root causes). `/usage` Details 502 fix, `datetime-local` → `DatePicker`, Est. Cost rendered to 2 decimal places.

**v0.0.43–v0.0.45** — Internal/intermediate.

**v0.0.46** — Adopt selected fixes from `decolua/9router` v0.4.40–v0.4.62. Remove 9router.com short-URL dependency from Cloudflare tunnel. Codex OAuth `redirect_uri` hardcoded to `localhost:1455`. Remove dead MITM exports. Ends with **781 tests** passing.

## Q2: Smoketest baseline + verification sweep (v0.0.47 → v0.0.48)

**v0.0.47** — Provider smoketest audit: `tests/smoke/all-providers.smoke.test.js` (+80 tests, exercises URL/header/body builders for every registered provider). Fix all 4 minor inconsistencies caught by audit (missing icons for qoder/gitlab/codebuddy, missing curated model lists for qoder/chutes/gitlab/codebuddy). **861 total tests**.

**v0.0.48** — Six-area verification sweep closing gaps left by v0.0.46 smoketest. Adds **+307 tests across 13 new files**: response parsing (streaming, tool calls, vision, reasoning), OAuth refresh for 9 providers, cookie/web canary (grok-web, perplexity-web), Vertex SA + Cloudflare AI realistic credentials, rate-limit/lockout invariants, region-aware providers. **3 latent crash fixes** along the way: `refreshGitHubToken`, `refreshIflowToken`, `refreshKiroToken` were missing the try/catch wrapper that `refreshClaudeOAuthToken` and `refreshCodexToken` already had — network errors threw uncaught. Ends at **1168 tests**.

## Q3: Security cleanup (v0.0.49 → v0.0.51)

**v0.0.49** — Sink-level log sanitizer (`src/sse/utils/logger.js`) closes CodeQL alert #39 (`js/clear-text-logging`, severity high). Sensitive object keys (`apiKey`, `access_token`, `refresh_token`, `cookie`, `authorization`, `password`, `secret`, `private_key`, `sa_json`) get prefix...suffix masking; token-shaped values inside strings (`Bearer …`, `sk-…`, JWT `eyJ…`) masked inline. Defense-in-depth — call-site `maskKey()` still works, but the sink is a backstop. **+20 tests, 1188 total**.

**v0.0.50** — Resolve all 14 open CodeQL alerts. **4 fixed** (SSRF in `models/test/route.js`, `models/availability/route.js`, `oauth/gitlab/pat/route.js` — hostname allowlist + URL reconstruct from parsed components). **10 dismissed** with formal justification (request-forgery in by-design proxy endpoints with `validateFetchUrl` already in place, xss-through-dom in React JSX with input sanitizers, insufficient-password-hash for high-entropy random API key tokens that aren't user passwords).

**v0.0.51** — Harden CodeQL #32–#35 fixes after re-scan **still flagged** them. Root cause: `localhost:${u.port}` still derived port from `request.url` (CodeQL traces Host header as user-tainted). Fix: take port from `process.env.PORT` validated as integer 1–65535, fallback 20128. For `oauth/gitlab/pat/route.js`: reconstruct fetch URL via `new URL("/api/v4/user", protocol + parsedHost + port)` so the fetch target is never a raw user string concat. **0 open CodeQL alerts after v0.0.51**.

## Q4: Provider lineup + UX (v0.0.52 → v0.0.54)

**v0.0.52** — Remove paid Perplexity API provider entirely (104 lines across 14 files). `perplexity-web` (cookie) untouched. Rationale: user only wants the web subscription path, the paid API mode is a separate product on `api.perplexity.ai` that's no longer in scope. **1187 tests**.

**v0.0.53** — Render Web Cookie Providers section in `/providers` UI. Was JSX-comment-wrapped (`{/* ... */}`) so `grok-web` and `perplexity-web` cards never appeared. Un-comment, import `WEB_COOKIE_PROVIDERS` from `@/shared/constants/config`. Trivial fix, large UX impact.

**v0.0.54** — `x-pod-skip-reasoning: true` opt-in header for `perplexity-web` perceived TTFT. Drops upstream search/read/plan thinking chunks; only markdown answer streamed. Same total latency, cleaner UX for clients that don't render `reasoning_content`. Cache + in-flight dedup verified to already work for perplexity-web (signature excludes `frontend_uuid`). **+6 tests**.

## Q5: Vercel relay + Kiro robustness (v0.0.55 → v0.0.56)

**v0.0.55** — Vercel relay hardening. Pod sends `x-relay-timeout = upstreamTimeoutMs - 5000` (min 1s) for deterministic race outcome — relay aborts first, error message is consistent. `chatCore.js` detects Vercel platform 504 + relay context, surfaces clear error. One-shot retry on relay 502/504 with 2s delay (cold-start mitigation). `/proxy-pools/[id]/test` switched from `httpbin.org` (unreliable) to `www.google.com/generate_204`. AGENTS.md rules #22–#24 added. **+17 tests**.

**v0.0.56** — Complete v0.0.55. v0.0.55 fixed pod-side timeout race, but `RELAY_FUNCTION_CODE` (the string deployed to Vercel) still ignored `x-relay-timeout`. v0.0.56 fixes that: relay function now reads the header, creates its own `AbortController`, aborts upstream fetch on timeout, returns 504 with `{ error: "Upstream relay request timed out" }`. Removed `runtime: "edge"` (default Node 20.x is more compatible with `duplex: "half"`). **Kiro transient retry** added separately: HTTP 500 with `MODEL_TEMPORARILY_UNAVAILABLE` body now body-gated retryable via separate `transientRetry` config (3 attempts, exp backoff 1s/2s/4s + 50%–150% jitter). `errorConfig.js` adds `isTransientErrorBody()` classifier matching `model_temporarily_unavailable`, `unexpectedly high load`, `temporarily unavailable`, `overloaded`. AGENTS.md rules #25–#26 added. **+14 tests, 1224 total**.

---

## Cumulative metrics

| Metric | v0.0.31 | v0.0.56 | Delta |
|---|---:|---:|---:|
| Tests | 711 | 1224 | +513 |
| Test files | 37 | 60 | +23 |
| AGENTS.md rules | 21 | 26 | +5 |
| Open CodeQL alerts | (not tracked) | 0 | — |
| Open Dependabot alerts | 0 | 0 | 0 |
| Latent crash fixes | — | 3 | — |

## Key rules introduced (AGENTS.md non-negotiable)

- **#22** — Vercel relay timeout has 5s safety margin
- **#23** — Vercel relay 502/504 gets one retry (2s delay)
- **#24** — Vercel relay test endpoint = `google.com/generate_204`
- **#25** — `RELAY_FUNCTION_CODE` must honour `x-relay-timeout`
- **#26** — Kiro 500 with `MODEL_TEMPORARILY_UNAVAILABLE` is body-gated retryable

## Files added

13 verification test files (v0.0.48), 1 logger sanitizer test (v0.0.49), 1 vercel-relay-timeout test (v0.0.55), 1 kiro-transient-retry test (v0.0.56), 1 perplexity-web extension (v0.0.54). Plus 7 new reports in `.agents/reports/`.

## What was deleted

- Paid Perplexity API provider (v0.0.52, 104 lines / 14 files)
- 9router.com short-URL dependency (v0.0.46)
- `disableCodexStreaming` workaround (v0.0.32)
- Dead MITM exports (v0.0.46)

## Operational notes for the next maintainer

- **Re-deploy Vercel relays** after v0.0.56 — old relay code (deployed pre-v0.0.56) does NOT honour `x-relay-timeout`. Existing pools must run `POST /api/proxy-pools/vercel-deploy` again to upgrade.
- **CodeQL default setup** is the GitHub-managed scan — runs weekly, not configurable from this repo. The custom `Code Quality: Push on main` workflow is what we control.
- **`x-pod-skip-reasoning`** is currently perplexity-web-specific — do not propagate to other providers without verification (most non-reasoning models don't emit `reasoning_content` so the flag would be a no-op).
