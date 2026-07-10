# Changelog

## [Unreleased]

### Fixed

- AbortError unhandledRejection spam on client disconnect: `request.text()` / `request.json()` now return `{ ok: false, reason: "aborted" }` via `readBodyText()` helper; routes return 499 cleanly. SSE stream wrappers in `src/sse/handlers/chat.ts` use `controller.close()` (not `controller.error(err)`) on reader abort, preventing the abort from re-surfacing in the Next.js response writer.
- Hard 10MB body cap raised to 50MB default (env-tunable: `POD_MAX_REQUEST_BODY_BYTES`, `POD_MAX_CHAT_BODY_BYTES`).
- Global `unhandledRejection` / `uncaughtException` handlers in `server-init.ts` and `instrumentation.ts` now classify `Error: aborted at node:_http_server` as `[ClientDisconnect]` (not `[FATAL]`) and dedupe log spam (1s window, 5-error threshold).
- Abort-safe body parsing applied to 6 sibling routes: `imageGeneration`, `tts`, `fetch`, `embeddings`, `search`, `pricing/sync`.
- `open-sse/handlers/chatCore.js`: catch block now filters `AbortError` and calls `controller.close()` instead of `controller.error(e)`.

## v0.0.79 (2026-06-05)

- Security hardening phase 1: error sanitization across 18+ API routes (`sanitizeError`)
- Security hardening phase 2: safe JSON body parsing across 45+ routes (`parseJsonBody`)
- Security hardening phase 3: upstream API body leak patches (13 additional routes)
- Security hardening phase 4: SSE/streaming crash hardening (3 containment points)
- Redis rate limiting with automatic backend selection
- Duck-type backend dispatch (replace constructor.name/instanceof — breaks in minified builds)
- RPM slot release when concurrent check fails after RPM passes
- Variable shadowing fixes in 3 OAuth routes

## v0.0.78 (2026-06-04)

- Fix Codex tool call response cut-off + reasoning effort normalization

## v0.0.77 (2026-06-03)

- Security hardening + upstream adoption + race fixes

## v0.0.76 (2026-06-02)

- Fix CHANGELOG, node:fs imports, .env.example branding

## v0.0.75 (2026-05-29)

- Fix Codex reasoning token budget + audit findings
- feat: Account Lockout Status section on /health page
- feat: 'Connected only' toggle on /media-providers/web page
- feat: connection-level lockdown with exponential cooldown

## v0.0.67 (2026-05-27)

- Fix Web Cookie providers showing 'No connections' + filter respect

## v0.0.66 (2026-05-27)

- Verify combo systemPrompt works for OpenCode Go (both routes)

## v0.0.65 (2026-05-26)

- Lock-in combo system prompt injection across all 6 provider shapes

## v0.0.64 (2026-05-26)

- /health page works for dashboard users + fix metrics

## v0.0.63 (2026-05-26)

- Enrich /api/monitoring/health with cache/sync/runtime metrics + API key auth

## v0.0.62 (2026-05-26)

- Clean noisy console.log spam in client components

## v0.0.61 (2026-05-26)

- Fix /api/usage/stats 400 on period=90d

## v0.0.60 (2026-05-26)

- Silence "no label associated with a form field" warnings — aria-label

## v0.0.59 (2026-05-26)

- Silence form-field autofill warnings — add id/name/aria-label

## v0.0.58 (2026-05-26)

- Silence Chrome 'preloaded but not used' CSS warning

## v0.0.57 (2026-05-26)

- Fix Add OpenAI/Anthropic Compatible modal — 400 silent failure

## v0.0.56 (2026-05-24)

- Relay function honours x-relay-timeout + Kiro transient retry

## v0.0.55 (2026-05-24)

- Harden Vercel relay (timeout race, platform 504, retry, healthcheck)

## v0.0.54 (2026-05-24)

- Perplexity-web perceived TTFT — x-pod-skip-reasoning header

## v0.0.53 (2026-05-24)

- Render Web Cookie Providers section in /providers

## v0.0.52 (2026-05-24)

- Remove paid Perplexity API provider

## v0.0.51 (2026-05-24)

- Harden CodeQL #32-#35 fixes (re-scan still flagged)

## v0.0.50 (2026-05-24)

- Resolve all 14 open CodeQL alerts

## v0.0.48 (2026-05-23)

- Sink-level log sanitizer for CodeQL #39

## v0.0.42 (2026-05-20)

- Fix /usage Details 502 error, replace datetime-local with DatePicker, fix Est. Cost to 2dp
- Fix OAuth: hardcode Codex redirect_uri to localhost:1455, remove dead mitm exports

## v0.0.36 (2026-05-19)

- Fix tunnel enable 'Unable to connect' error — 3 root causes fixed
- Rename 'System Health' to 'Health' + align page spacing with /memory and /cache
- Persist ReactFlow viewport to sessionStorage + rename Usage title
- Rename 'Providers' to 'LLM Providers' in header, breadcrumbs, page title
- Center-align 'No connected providers' placeholder in /media-providers

## v0.0.33 (2026-05-19)

- Fix /quota double-click expand bug + add Last Request At column
- Fix /usage Details tab always showing empty — observability config + id propagation

## v0.0.32 (2026-05-18)

- Fix Codex 502 invalid JSON response, remove disableCodexStreaming workaround

## v0.0.31 (2026-05-18)

- Add memory pipeline, retrieval, store integration tests (711 tests)
- Fix clearInFlight called in all cache paths, add memory+cache edge case tests (653 tests)
- Fix SQLite TTL datetime format, clearInFlight on large responses, add cache integration tests
- Include memoryOwnerId in cache signature, fix temperature default, bump cache size to 512KB

## v0.0.30 (2026-05-17)

- Add 26 Vertex AI stream guard tests
- Add missing testClaude stub, fix cloud branding, add 39 cloud tests
- Sanitize browser network errors in tunnel enable, wrap fetchData non-fatal, remove DNS warmup delay

## v0.0.29 (2026-05-16)

- Add INITIAL_PASSWORD, BASE_URL, CLOUD_URL env vars to README

## v0.0.28 (2026-05-16)

- Restore hideDisabled toggle behavior in /quota, remove permanent filter
- Ping tunnelUrl instead of publicUrl for faster tunnel health check
- Remove requestTooLargeForCache guard (generateSignature handles large payloads)
- Skip stream field injection for Vertex AI target format
- Fix models.dev sync — read cost from .cost field, fix 0 model count
- Remove Melma from API Key providers

## v0.0.27 (2026-05-16)

- Replace 9Router branding with Pod across repo
- Add .pi to gitignore

## v0.0.25 (2026-05-15)

- Fix recheckAndClear re-lock respects backoff multiplier
- Migrate Inter and IBM Plex Mono to next/font, suppress Material Symbols lint

## v0.0.24 (2026-05-15)

- Add perf-cpu-hotpath tests for SSE hotpath fixes
- Reduce CPU load from SSE hot paths

## v0.0.23 (2026-05-15)

- Resolve 14 CodeQL security alerts
- Fix: skeleton on initial load across health/usage/cache/memory/endpoint pages
- Fix: model lockout recheck before clear, spinner icon, human-readable duration
- Fix: console logs "Showing x of y logs" below log list
- Fix: combo test uses /api/models/test endpoint, spinner icon
- Feat: quota toolbar toggles with session persistence + logs live state

## v0.0.22 (2026-05-14)

- Fix provider topology active node border white instead of orange
- Fix providers/media-providers Connected Only filter + remove arrow buttons
- Fix semantic cache always 0% hit rate — temperature/top_p normalization

## v0.0.21 (2026-05-14)

- Feat: health page SSE live update
- Fix minimum lockout time not applied correctly
- Persist Connected Only toggle state in localStorage

## v0.0.20 (2026-05-14)

- Resolve remaining 14 CodeQL security alerts
- Update RWX workflows for pod repo

## v0.0.19 (2026-05-14)

- Feat: configurable minimum lockout time with exponential multiplier
- Fix semantic cache 0% hit rate due to memory injection signature mismatch
- Fix console/request logs height
- Fix quota page toolbar improvements
- Health page improvements

## v0.0.18 (2026-05-14)

- Exclude disabled models from provider quota progress
- Resolve all 23 CodeQL security alerts

## v0.0.17 (2026-05-13)

- Feat: drag-to-reorder combos and provider connections
- Multi-account custom providers

## v0.0.15 (2026-05-13)

- Fix Codex provider freeze during tool calls
- Add CONTRIBUTING.md, SECURITY.md, update README

## v0.0.14 (2026-05-13)

- Add paseo.json to .gitignore, remove melma-router binary

## v0.0.13 (2026-05-13)

- Fix memory leaks — reduce RSS from 1.2GB to ~200-400MB
- Fix browser tab title "Pod ✦ Pod ✦ Health" → "Pod ✦ Health"
- Fix semantic cache 0% hit rate — temperature threshold too strict
- Bound usage_history growth, debounce stats SSE

## v0.0.12 (2026-05-13)

- Add `bun run check` script — format, lint, type check

## v0.0.11 (2026-05-13)

- Fix usage chart — linear line instead of curved
- Request logs SSE: detect PENDING→SUCCESS/FAILED, poll 1s when pending
- Fix usage stats Cost/Tokens pill tabs — standardize to SegmentedControl

## v0.0.9 (2026-05-13)

- Fix usage chart white graph color for Tokens/Cost
- Fix console logs timestamp column width
- Improve upstream error logging — URL, model, status code
- Model test bypasses semantic cache via x-pod-no-cache header
- Request log detail: abort previous fetch on new selection

## v0.0.8 (2026-05-13)

- Memory extraction: add Indonesian language patterns for preference/decision/habit

## v0.0.7 (2026-05-13)

- Thundering herd protection for semantic cache via in-flight deduplication
- LRU connection cache, cooldown guard, queue depth metrics, rate limit docs

## v0.0.6 (2026-05-13)

- Security: API key auth on GET /v1/models endpoints; timing-safe comparison
- Kebab-case URL redirects for web-search/web-fetch
- Move Connected Only toggle to header action slot
- Provider nodes: optional Identifier field
- Adopt upstream fixes — developer role norm, stream stall timeout, Ollama usage, Gemini schema, DATA_DIR fallback, Today period, Blackbox provider, MiniMax TTS

## v0.0.5 (2026-05-12)

- Standardize Button and Badge usage across app
- Quota page: Collapse All, rename Progress→Quota column
- Console logs: Refresh/Live toggle, Connecting status fix
- Combos page: Test button per combo
- Provider health grouped by provider, show provider icon
- Remove MITM bypass feature entirely
- Settings: remove Migrate to SQLite button

## v0.0.4 (2026-05-12)

- Replace all browser confirm() with in-app ConfirmModal across all pages
- Fix breadcrumb label alignment
- Fix memory page crash — missing confirmDialog state

## v0.0.3 (2026-05-12)

- Console logs: toolbar in header, level filter pills
- Request logs: search/filter, SSE live stream, detail payload fix
- Proxy logs: silent refresh, configured count always visible
- Standardize pill tabs with SegmentedControl across /usage and /logs
- Quota page: grouped by provider with 3-level expand/collapse
- Remove close button from sonner toasts
- Add @custom-variant dark for Tailwind v4 dark mode

## v0.0.2 (2026-05-11)

- Health page: Rate Limit Status, Model Lockout Status, sparklines
- Logs page: multi-tab (Request Logs, Proxy Logs, Console)
- Usage page: ReactFlow topology, metric cards redesign, Details tab
- Replace custom toast with sonner, position bottom-right
- Theme toggle, light theme implementation
- API keys table with pagination (15 per page)
- Sidebar: larger app name, version label, custom SVG logo

## v0.0.1 (2026-05-10)

- Fork from 9Router — reset version to v0.0.1
- Rebrand: 9Router → Pod across code, branding, Docker image, data dir
- Migrate runtime from Node.js to **bun**
- Remove `/dashboard` prefix from all routes
- Replace better-sqlite3 with bun:sqlite (SQLite via bun native)
- Docker image: `lazuardytech/pod`
- CI/CD: GitHub Actions build + Docker publish on tag push
- OpenSSE imported locally (jsconfig.json alias)
- Core pages adapted: login, endpoint, providers, logs, usage, health, settings, memory, cache
