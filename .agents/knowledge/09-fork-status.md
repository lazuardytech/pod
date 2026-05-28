# Fork Status

## Repository Identity

- Repo: `github.com/lazuardytech/pod`
- Branch: `main`
- Current tagged release: **v0.0.31**

## Release History

| Tag | Highlights |
|---|---|
| `v0.0.1` | Rebranding 9router → Pod, bun migration, route restructure, Linear design system |
| `v0.0.2` | Sonner toasts, request log dedup, status rename SUCCESS, toolbar lifting |
| `v0.0.3` | Full bun runtime (`oven/bun:1.3.14-alpine`), `bun:sqlite` production, Tailscale fix, Codex OAuth fix |
| `v0.0.4` | Quota grouped table, usage chart 90d, ConfirmModal everywhere, MITM removed, `details_id` linking |
| `v0.0.5` | Console logs Live/Refresh, quota no-flicker, SegmentedControl standardized, system info from API |
| `v0.0.6` | Request/Proxy Logs SSE stream, model listing auth, `headerActionStore`, Blackbox + MiniMax, semantic cache `stream=undefined` fix, upstream fixes |
| `v0.0.7–v0.0.11` | Streaming cache fix, provider node rename, model lock tests, cache/memory tests, log cap 10K, logs UX, button color fix (`text-primary-fg`) |
| `v0.0.12` | `renameProviderNode` atomic cascade, `PATCH /api/provider-nodes/[id]/rename`, `bun run check` script, 433 total tests |
| `v0.0.13` | Memory leak fixes (1.2GB → ~200–400MB): SSE abort cleanup, LRUCache for memory store, SQLite pragma reduction, `bun --smol`, cache temperature threshold `> 1` |
| `v0.0.14` | ESLint fix, `paseo.json` gitignored, `melma-router` binary removed |
| `v0.0.15` | Remove `--smol`, add cache memory env vars, CONTRIBUTING.md, SECURITY.md, README improvements |
| `v0.0.16` | (skipped) |
| `v0.0.17` | Drag-to-reorder combos + provider connections (`@dnd-kit`), multi-account custom providers, `sort_order` SQLite migration |
| `v0.0.18` | Fix all 23 CodeQL security alerts (SSRF, insecure randomness, XSS, stack trace, workflow permissions) |
| `v0.0.19` | Biome `--unsafe` lint fixes, quota page disabled-model filter, `h-1.5` progress bars, health page improvements |
| `v0.0.20` | Semantic cache 0% hit rate fix (memory injection signature mismatch), configurable minimum lockout time, quota toolbar improvements, logs `h-[70vh]`, health page lockout clear button |
| `v0.0.21` | Minimum lockout fix: guard too aggressive (skipped longer cooldowns), `resetsAtMs` path skipped minimum; both fixed in `auth.js` |
| `v0.0.22` | Semantic cache: temperature/top_p normalization, `approxRequestBytes` content-block fix; cache hit rate now reliable |
| `v0.0.23` | Perf: `PRAGMA integrity_check` cached 5min, health stream 10s interval, request-logs stream fixed 2s poll; 23 new SSE hotpath tests |
| `v0.0.24` | API key `last_access_at` tracked on every auth request, shown in /endpoint table; Est. Cost rounds up to 2 decimal places |
| `v0.0.25` | models.dev pricing sync: `src/lib/modelsDevSync.js`, periodic sync on boot, "Sync Now" in /settings, `GET/POST /api/pricing/sync`; pricing resolution order: overrides → models.dev → static |
| `v0.0.26` | Model lock count tracking: `modelLockCount_${model}` flat field, backoff multiplier (1x/2x/3x…); Vertex AI `stream` field removed from request body; semantic cache `requestTooLargeForCache` guard removed |
| `v0.0.27` | Bug fixes: tunnel pings `tunnelUrl` not `publicUrl`; /providers "Connected Only" noAuth fix; /media-providers grid from `allProviders`; /quota disabled always hidden, toolbar state to localStorage; /usage Details observability toggle reads both fields |
| `v0.0.28` | UI: /providers detail up/down arrows removed (drag handles priority); /health Model Lockout moved below Provider Health, custom icons fixed; /combos "Test All" button; /logs Proxy Logs Actions column fixed width; /quota white active style on collapse/expiring/hide buttons; Melma removed from APIKEY_PROVIDERS |
| `v0.0.29` | Tunnel enable error sanitization + non-fatal `fetchData()`; cloud worker `testClaude.js` stub (410 deprecated); Vertex AI stream guard tests (26); console logs scroll-to-bottom on `init`; quota hide-disabled toggle fix; README env vars (`INITIAL_PASSWORD`, `BASE_URL`, `CLOUD_URL`); 533 total tests (31 files) |
| `v0.0.30` | (intermediate) |
| `v0.0.31` | Semantic cache fixes: SQLite TTL (`strftime` ISO 8601), `memoryOwnerId` in signature (cross-user cache bleed prevention), temperature `null`→`1` normalization, 512KB response limit, `clearInFlight` unconditional in all 3 response paths; memory strategy fixes (`"recent"` explicit alias for `"exact"`, `/api/memory` added to `PROTECTED_API_PATHS`); 711 total tests (37 files) |
| `v0.0.32` | Codex 502 invalid JSON response fix; remove `disableCodexStreaming` workaround |
| `v0.0.33` | /quota double-click expand bug + Last Request At column; localStorage toggle hydration fix |
| `v0.0.34–v0.0.35` | (intermediate, no published changelog) |
| `v0.0.36` | UI polish: rename 'Providers' → 'LLM Providers', breadcrumb fixes, /media-providers placeholder centering, ReactFlow viewport persists to sessionStorage |
| `v0.0.37–v0.0.41` | (intermediate, no published changelog) |
| `v0.0.42` | Tunnel enable 'Unable to connect' error — 3 root-cause fixes; /usage Details 502 fix, datetime-local → DatePicker, Est. Cost to 2dp |
| `v0.0.43–v0.0.45` | (intermediate, no published changelog) |
| `v0.0.46` | Adopt selected fixes from decolua/9router v0.4.40–v0.4.62; remove 9router.com short-URL dependency from Cloudflare tunnel; Codex OAuth `redirect_uri` hardcoded to `localhost:1455`; remove dead MITM exports; 781 tests pass |
| `v0.0.47` | Provider smoketest audit (`tests/smoke/all-providers.smoke.test.js`, +80 tests); fix all 4 minor inconsistencies caught by audit (icons for qoder/gitlab/codebuddy, curated model lists for qoder/chutes/gitlab/codebuddy); 861 total tests |
| `v0.0.48` | Provider verification sweep — close 6 unverified gaps from v0.0.46 smoketest. +307 tests across 13 new files (response parsing, OAuth refresh for 9 providers, cookie/web canary, Vertex SA + Cloudflare AI, rate-limit/lockout, region-aware). **3 latent crash fixes**: `refreshGitHubToken`, `refreshIflowToken`, `refreshKiroToken` wrapped in try/catch matching existing pattern. 1168 tests pass |
| `v0.0.49` | Sink-level log sanitizer (`src/sse/utils/logger.js`) closes CodeQL #39 clear-text-logging. Sensitive object keys (apiKey, access_token, refresh_token, cookie, authorization, password, secret, private_key, sa_json) redacted; token-shaped strings (Bearer, sk-, JWT eyJ) masked inline. Defense-in-depth on top of call-site `maskKey()`. +20 tests, 1188 total |
| `v0.0.50` | Resolve all 14 open CodeQL alerts: 4 fixed (SSRF in `models/test/route.js`, `models/availability/route.js`, `oauth/gitlab/pat/route.js` — hostname allowlist + URL reconstruct), 10 dismissed with justification (request-forgery in by-design proxy endpoints, xss-through-dom in React JSX with sanitizers, insufficient-password-hash for high-entropy API key tokens) |
| `v0.0.51` | Harden CodeQL #32–#35 fixes after re-scan still flagged. `models/test|availability/route.js` now derive port from `process.env.PORT` (validated 1–65535) with fallback 20128 — no `request.url` is touched. `oauth/gitlab/pat/route.js` reconstructs fetch URL from parsed components. **0 open CodeQL alerts** |
| `v0.0.52` | Remove paid Perplexity API provider entirely (104 lines across 14 files); `perplexity-web` (cookie) untouched. Configs, search, normalizer, caller, model alias, validation, models.dev sync all stripped of `perplexity` (API). 1187 tests |
| `v0.0.53` | Render Web Cookie Providers section in `/providers` UI (was JSX-comment-wrapped). Import `WEB_COOKIE_PROVIDERS` from `@/shared/constants/config` and un-comment. `grok-web` and `perplexity-web` cards now visible |
| `v0.0.54` | `x-pod-skip-reasoning: true` opt-in header for `perplexity-web` perceived TTFT. Drops upstream search/read/plan thinking chunks; only markdown answer streamed. Same total latency, cleaner UX for clients that don't render `reasoning_content`. Cache + in-flight dedup verified to already work for perplexity-web (signature excludes `frontend_uuid`). +6 tests |
| `v0.0.55` | Vercel relay hardening: pod sends `x-relay-timeout = upstreamTimeoutMs - 5000` (min 1s) for deterministic race outcome; `chatCore.js` detects Vercel platform 504 + retries cold-start 502/504 once with 2s delay; `/proxy-pools/[id]/test` switched from httpbin.org to `www.google.com/generate_204`. AGENTS.md rules #22–#24 added. +17 tests |
| `v0.0.56` | Complete v0.0.55: `RELAY_FUNCTION_CODE` (deployed-to-Vercel string) now reads `x-relay-timeout` and aborts upstream via own `AbortController` — v0.0.55 only fixed pod-side; relay function still ignored the header. Removed `runtime: "edge"` from relay (default Node 20.x is more compatible with `duplex: "half"`). **Kiro transient retry**: HTTP 500 with `MODEL_TEMPORARILY_UNAVAILABLE` body now body-gated retryable via separate `transientRetry` config (3 attempts, exp backoff 1s/2s/4s + 50%–150% jitter). `errorConfig.js` adds `isTransientErrorBody()` classifier. AGENTS.md rules #25–#26 added. +14 tests, 1224 total |

## Current Remote Setup

```bash
git remote -v
# origin  git@github.com:lazuardytech/pod.git
```

No `upstream` remote configured.

## Divergence Notes

Branch is intentionally customized for Lazuardy Tech needs:

1. bun-first build and CI flow
2. Docker publish to Docker Hub `lazuardytech/pod`
3. Memory/cache/rate-limit features integrated into API and dashboard
4. Linear design system (dark/light theme)
5. Internal contributor docs (`AGENTS.md`, `.agents/*`) maintained in-repo
6. Version reset to v0.0.1 as new identity baseline

## Docker Hub

- Image: `lazuardytech/pod`
- Tags: `v0.0.1`–`v0.0.56`, `latest`
- Platform: `linux/amd64`
