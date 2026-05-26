# 9router → pod: Feature Presence Report

> Pod baseline: **v0.0.44**, internal name `pod`, `open-sse/` as local source.
> MITM removed in v0.0.4 (gotcha #15).
> Date: 2026-05-26 (read-only investigation).

Legend: ✅ present, ⚠️ partial, ❌ missing, 🟦 N/A (not applicable to pod), ⭐ pod ahead.

---

## Translator / Engine fixes

### 1. Sanitize Read tool args (strip `pages`) — **❌ MISSING**

- No `sanitizeToolArguments` symbol anywhere in the tree.
- No `pages` handling in `open-sse/translator/` or `open-sse/executors/`.
- `grep -r "pages"` in `open-sse/translator/` returns nothing.
- Existing tool-arg helper is only `open-sse/translator/helpers/toolCallHelper.js` (`sanitizeToolId` for tool_call_id only — sanitizes IDs to ≤40 chars, not arguments).
- Likely target file if porting: `open-sse/translator/request/openai-to-claude.js` (lines ~225–270 process `tool_use` blocks).

### 2. Strip empty Read pages in OpenAI→Claude translator — **❌ MISSING**

- Same as #1 — no `sanitizeToolArguments`, no empty-string optional-field stripping.
- `open-sse/translator/request/openai-to-claude.js` is otherwise active (lines 11–280) but has no equivalent guard.

### 3. `json_schema` fallback for OpenAI-compatible providers — **⚠️ PARTIAL (Claude/Github only, not openai-compatible-*)**

- ✅ `openai-to-claude` translator handles `response_format.type === "json_schema"`: `open-sse/translator/request/openai-to-claude.js:108-122` — appends schema as system instruction.
- ✅ `github` executor handles json_schema for Claude-via-GitHub: `open-sse/executors/github.js:48-78` — injects raw-JSON instruction into system + last user message.
- ❌ No fallback for `openai-compatible-*` provider nodes. `executors/default.js:19-24` simply forwards request as-is to custom baseUrl. `transformRequest` does not touch `response_format`.
- ❌ No downgrade `json_schema` → `json_object` for openai-compatible-*.
- Gap: would need to detect `provider.startsWith("openai-compatible-")` in `executors/default.js` `transformRequest` and inject schema + downgrade.

### 4. Codex auto-retry on stream drop — **❌ MISSING**

- `open-sse/executors/codex.js` (280 lines) has no retry-on-stream-drop logic.
- `open-sse/handlers/chatCore/streamingHandler.js` and `open-sse/utils/stream.js` have no retry/reconnect path. `stream.js:91-146` only emits a stall-timeout error after 3 min.
- No `retry`, `attempt`, `reconnect` keywords in chatCore handlers.
- Gap: needs reconnection wrapper around upstream fetch with stream-position resume (or simple reissue on early disconnect before `[DONE]`).

### 5. Codex random 400/404, tool-calling, prompt cache — **❌ MISSING (probably)**

- No fork-specific `prompt_cache_key` injection in `open-sse/executors/codex.js`. Pod actively *deletes* `prompt_cache_retention` at line 239 ("Cursor sends this but Codex doesn't support it").
- `prompt_cache_key` is only set in `open-sse/handlers/imageProviders/codex.js:185` (image gen) and stripped in responses translator (`responsesApiHelper.js:129`, `openai-responses.js:153`).
- 9router's specific 400/404 stability fixes for chat Codex would need diff inspection; **none of the obvious symptoms (tool-call sanitization, prompt cache hint) are present.**

### 6. MITM Antigravity 2.x support — **🟦 N/A (confirmed removed)**

- ⭐ Pod removed MITM entirely in v0.0.4 (`.agents/knowledge/07-gotchas.md:75-77`, `01-overview.md:83`, `02-architecture.md:174`).
- Git log confirms: `dc05812 → e7c596d` "remove MITM bypass feature entirely from proxyFetch and localDb"; `56d9513 → d9b2914` "remove dead mitm exports".
- Only residual: `.gitmodules` references `src/mitm/dev` submodule (unused), test fixture `tests/unit/sqlite-migration.test.js:56` references `mitmAlias` (legacy migration test).
- Antigravity 2.x AG/IDE support would only matter if MITM came back — explicitly forbidden by gotcha #15.

### 7. Forward Gemini `outputDimensionality` for embeddings — **❌ MISSING**

- `open-sse/handlers/embeddingProviders/gemini.js` builds body without `outputDimensionality` — only passes `model` + `content.parts.text`.
- `open-sse/handlers/embeddingsCore.js:43` passes `dimensions: body.dimensions` to adapter, but Gemini adapter ignores it (only OpenAI adapter uses it: `embeddingProviders/openai.js:28-33`).
- Gap: add `dimensions` handling in `embeddingProviders/gemini.js` `buildBody`, mapping to Gemini's `outputDimensionality` field.

### 8. setState-in-effect errors fix (LanguageSwitcher / UsageStats) — **🟦 N/A (LanguageSwitcher) / ⚠️ unknown (UsageStats)**

- ❌ No `LanguageSwitcher` component anywhere in the tree. No i18n infrastructure (no `setLanguage` / `i18n` calls outside media-providers form fields). Pod is English-only.
- ⚠️ `src/shared/components/UsageStats.js:210` exists but `grep` for `isInitialLoad` returns nothing — pod doesn't use the upstream pattern. Whether pod has its own setState-in-effect bug requires deeper review.

### 9. Gemini CLI: reuse stored OAuth project IDs — **✅ PRESENT (and ⭐ ahead)**

- ⭐ Pod has a dedicated `open-sse/services/projectId.js` with:
  - 1h TTL cache (`projectIdCache` Map, `CACHE_TTL_MS = 60 * 60 * 1000`)
  - In-flight fetch dedup (`pendingFetches` Map with `AbortController` per fetch)
  - Periodic cleanup (10 min sweep)
  - `getProjectIdForConnection`, `invalidateProjectId`, `removeConnection` API
- `src/sse/handlers/chat.js:250-256` reuses cached projectId; if missing, fetches and persists via `updateProviderCredentials`.
- `executors/gemini-cli.js:28-30` uses `credentials.projectId` directly when present.
- 9router's `geminiCliProjectId` field name doesn't appear; pod uses generic `projectId` on credentials (works for both `gemini-cli` and `antigravity`).

---

## Network / infra

### 10. Reduce fetch connect timeout 30s → 20s — **❌ NOT CONFIGURED**

- `open-sse/utils/proxyFetch.js` does not configure `connectTimeoutMs` on its undici `ProxyAgent`.
- `ProxyAgent` is constructed bare: `new ProxyAgent({ uri: normalized })` (line 95).
- No `connectTimeout`, `connect_timeout`, `connectTimeoutMs` keyword anywhere in repo.
- Falls back to undici default (10s connect timeout, but tunable). Neither 20s nor 30s is set explicitly.

### 11. Tunnel refactor into Cloudflare/Tailscale modules — **✅ PRESENT (already modular)**

- `src/lib/tunnel/` already split:
  - `cloudflared.js` (Cloudflare-specific binary management, spawn, download)
  - `tailscale.js` (Tailscale-specific funnel/login)
  - `tunnelManager.js` (orchestrator with separate `tunnelSvc` / `tailscaleSvc` state objects)
  - `networkProbe.js`, `state.js`, `tunnelConfig.js` (shared)
- `tunnelManager.js:21-49` shows clean per-service separation.
- Pod is at parity with or ahead of upstream's split.

### 12. tokenRefresh in-flight dedup — **✅ PRESENT (and ⭐ robust)**

- `open-sse/services/tokenRefresh.js:7-25,556-571`:
  - `refreshPromiseCache = new Map()` keyed by `${provider}:${refreshToken}`
  - LRU eviction at `MAX_REFRESH_CACHE_SIZE = 100`
  - Auto-cleanup interval `CACHE_CLEANUP_INTERVAL_MS = 60_000`, max age 5 min
  - Explicit comment "prevents race condition that triggers refresh_token_reused → Auth0 family revoke"
  - `isUnrecoverableRefreshError` recognizes `refresh_token_reused`, `invalid_grant`, etc.
- `src/sse/services/tokenRefresh.js:179` has additional in-flight dedup at the SSE handler layer.
- Test coverage: `tests/unit/codex-refresh-token.test.js`.

### 13. Cloudflare Workers proxy deployer — **❌ MISSING**

- `src/app/api/proxy-pools/` only has `vercel-deploy/` (no `cloudflare-deploy/`).
- `src/app/(dashboard)/proxy-pools/ProxyPoolsClient.js` only has `showVercelModal` / `handleVercelDeploy`. No CF Workers deploy UI.
- `route.js:10` valid types: `["http", "vercel"]` only. CF Workers type would need to be added.
- No `cf-deploy`, `cloudflareDeploy`, `cfWorker` keywords anywhere.
- Pod has its own `cloud/` directory (CF Workers proxy backend, statically deployed via `wrangler.toml`) but no per-user deploy-from-dashboard flow.

### 14. Deno Deploy relays support — **❌ MISSING**

- No `deno-deploy`, `denoDeploy`, `deno.dev` keywords anywhere.
- `src/app/api/proxy-pools/route.js:10` valid types: `["http", "vercel"]`. Needs `"deno"` added + a `deno-deploy/` handler.

---

## From earlier 9router releases

### 15. xAI Grok provider — **✅ PRESENT (and ⭐ extensive)**

- `src/shared/constants/providers.js:560-572` — `xai` provider config.
- `src/shared/constants/providers.js:1497-1506` — `grok-web` (subscription cookie auth).
- `open-sse/executors/grok-web.js` — full executor with model map (grok-3, grok-4, grok-4.1-mini/fast/expert/thinking, grok-4.20, etc.) and SSE NDJSON parser.
- `tests/unit/web-cookie-validation.test.js` — Grok cookie validation tests.
- Pricing: `src/shared/constants/pricing.js:101-103,242-243`.
- ⭐ Pod has both API (`xai`) and Web (`grok-web` cookie) variants; some upstream variants may not have web cookie support.

### 16. Vercel AI Gateway provider — **❌ MISSING**

- No `vercel-ai-gateway`, `aiGateway`, `gateway.ai.vercel.com`, etc. keywords.
- `vercel*` references in pod are only for **Vercel Relay** (proxy-pool deployer that proxies traffic via a deployed Vercel function). That's different from Vercel AI Gateway (a managed multi-provider AI router).
- Pod's `src/shared/constants/providers.js` provider list does not include a `vercel` provider id.

### 17. Kiro provider full translation + RTK compression — **✅ PRESENT (translator) / ⚠️ RTK partial**

- `open-sse/translator/request/openai-to-kiro.js` (308+ lines) — full OpenAI→Kiro conversion: history + currentMessage split, tool merging, model rewriting (lines 15, 49-90, 269-295).
- `open-sse/executors/kiro.js` — full executor with token refresh, context-percentage tracking (line 320).
- ⚠️ RTK compression: `open-sse/rtk/caveman.js:26` lists kiro as OpenAI-shaped target. `open-sse/handlers/chatCore.js:405-408` calls `compressMessages(translatedBody, ...)` — applies to all providers including kiro.
- Test coverage: `tests/unit/rtk.multi-provider.e2e.test.js:107` covers `antigravity`. Kiro RTK coverage in same e2e test (entries 80–141 iterate over routes incl. "kiro" if listed). Lines 142-153 verify `[RTK] git-diff` log line per route.
- Possible gap: 9router may have specific *conversation history* compression (RTK on `history` array, not just last `currentMessage`). Pod's `compressMessages` runs on full body before split — needs verification.

### 18. OIDC dashboard login — **❌ MISSING (password-only)**

- `src/app/login/LoginClient.js` is **password-only** (`password`, `hasPassword`, `isDefaultPassword`).
- `src/app/api/auth/` has only `login/` and `logout/`. No OIDC/SSO routes.
- `src/lib/oauth/services/` are all **provider OAuth** (Antigravity, Codex, Kiro, etc.) for upstream LLM auth — none are dashboard SSO.
- "OIDC" keyword hits all reference AWS SSO OIDC for Kiro auth, not dashboard SSO.
- Gap: would need new `/api/auth/oidc/*` routes, an OIDC client lib, and login-page IdP buttons.

### 19. Linux/arm64 Docker — **❌ NOT BUILT**

- `.github/workflows/docker-publish.yml:57,71` — `platforms: linux/amd64` only (both release and manual workflows).
- `Dockerfile:3` — `FROM --platform=linux/amd64 ${BUN_IMAGE} AS builder`. Hardcoded amd64 in builder stage.
- Note: `Dockerfile:43` has Tailscale `aarch64) TS_ARCH=arm64` mapping, suggesting runner detection is aware of arm64 but the build itself is amd64-locked.
- Easy fix if needed: change `platforms` to `linux/amd64,linux/arm64` and remove `--platform=linux/amd64` builder pin.

### 20. MCP stdio→SSE bridge — **❌ MISSING**

- `src/app/api/mcp/` does **not exist**.
- No `mcp.*sse`, `mcp/[plugin]` keywords.

### 21. Linux cert NSS DB injection — **🟦 N/A**

- Confirmed N/A: pod removed MITM (gotcha #15). NSS DB injection only matters for HTTPS interception.

### 22. OAuth callback postMessage scoped to expected origins (CWE-1385) — **✅ PRESENT (and ⭐ explicitly hardened)**

- `src/app/callback/page.js:34-52`:
  - Allowlist `expectedOrigins = [window.location.origin, "http://localhost:1455"]`
  - Loops over allowlist with explicit per-origin `postMessage(..., origin)`
  - Comment block (lines 27-46) explicitly cites the threat model: "Any other origin is treated as hostile (drive-by attacker that opened the popup against the well-known redirect_uri to phish the code)."
  - "using `*` here would leak the code/state to any opener" — explicit `"*"` rejection.

### 23. Re-enable TLS verification on DNS-bypass fetch (CWE-295) — **🟦 N/A (DNS-bypass removed)**

- `open-sse/utils/proxyFetch.js` has no DNS-bypass path. Only env proxy + Vercel relay forwarding.
- No `rejectUnauthorized: false`, no `MITM_BYPASS_HOSTS`, no `createBypassRequest`, no `resolveRealIP`. Confirmed by gotcha #15.

### 24. Normalize `developer` role → `system` for OpenAI-format providers — **✅ PRESENT (multiple layers)**

- `open-sse/translator/index.js:67-74,98-99` — global `normalizeDeveloperRole(body)` runs in translator pipeline.
- `open-sse/translator/helpers/openaiHelper.js:13-14` — per-message normalization in OpenAI helper.
- `open-sse/executors/perplexity-web.js:153` — per-executor normalization.
- `open-sse/executors/grok-web.js:58` — same.
- `tests/unit/perplexity-web.test.js:49` — test coverage.
- Pod release note: commit `f0af897` "developer role normalization".

### 25. Stream stall timeout (3 min) — **✅ PRESENT**

- `open-sse/utils/stream.js:91` — `STALL_TIMEOUT_MS = 180_000`.
- `stream.js:131-146` — emits `{ error: { code: "stream_stall" } }` + `[DONE]` after 3 min idle, with timer reset on every received chunk.
- Documented at `.agents/knowledge/02-architecture.md:212` and `01-overview.md:106`.

### 26. MITM JSON cache — **🟦 N/A**

- N/A: pod has no MITM. Gotcha #15.

### 27. MiniMax TTS provider — **✅ PRESENT**

- `src/shared/constants/providers.js:374-396` — `minimax` provider with TTS models (speech-02-hd, speech-02-turbo, speech-01-hd, speech-01-turbo).
- `src/shared/constants/providers.js:388` — `format: "minimax-tts"`.
- `open-sse/handlers/ttsProviders/` directory holds adapters; adoption recorded in `.agents/knowledge/02-architecture.md:216` and commit `f0af897`.
- Also has `minimax-cn` variant (line 398).

### 28. buildOutput RTK filter — **❌ MISSING**

- `open-sse/rtk/filters/` contains: `dedupLog.js`, `find.js`, `gitDiff.js`, `gitStatus.js`, `grep.js`, `ls.js`, `readNumbered.js`, `searchList.js`, `smartTruncate.js`, `tree.js`.
- No `buildOutput.js` / `npm` / `yarn` / `cargo` build-log filter.
- Gap: drop a new filter into `open-sse/rtk/filters/buildOutput.js` and register in `rtk/registry.js`.

### 29. bun:sqlite adapter — **✅ PRESENT (rule #1, gotcha #2)**

- Per `AGENTS.md` rule 1 (bun only) and gotcha #2 (storage facade `src/lib/sqlite/connection.js`).
- `package.json` declares `bun@1.3.14`.
- `src/lib/sqlite/connection.js` (per `.agents/knowledge/02-architecture.md`) is the bun:sqlite-backed connection. Pod has been bun-only since v0.0.1 rebrand.

---

## Summary table

| # | Item | Status |
|---|------|--------|
| 1 | Sanitize Read tool args (pages) | ❌ |
| 2 | Strip empty Read pages in OpenAI→Claude | ❌ |
| 3 | json_schema fallback for openai-compatible-* | ⚠️ (claude/github only) |
| 4 | Codex auto-retry on stream drop | ❌ |
| 5 | Codex 400/404, tool-calling, prompt cache | ❌ |
| 6 | MITM Antigravity 2.x | 🟦 (MITM removed) |
| 7 | Gemini outputDimensionality embeddings | ❌ |
| 8 | LanguageSwitcher / UsageStats setState-in-effect | 🟦 / ⚠️ |
| 9 | Gemini CLI projectId reuse | ✅ ⭐ |
| 10 | fetch connect timeout 30s→20s | ❌ |
| 11 | Tunnel refactor (CF/Tailscale split) | ✅ |
| 12 | tokenRefresh in-flight dedup | ✅ ⭐ |
| 13 | Cloudflare Workers proxy deployer | ❌ |
| 14 | Deno Deploy relays | ❌ |
| 15 | xAI Grok provider | ✅ ⭐ (api + web) |
| 16 | Vercel AI Gateway provider | ❌ |
| 17 | Kiro full translation + RTK compression | ✅ / ⚠️ |
| 18 | OIDC dashboard login | ❌ |
| 19 | Linux/arm64 Docker | ❌ |
| 20 | MCP stdio→SSE bridge | ❌ |
| 21 | Linux cert NSS DB injection | 🟦 |
| 22 | OAuth callback postMessage origins | ✅ ⭐ |
| 23 | TLS verify on DNS-bypass | 🟦 |
| 24 | developer→system normalization | ✅ |
| 25 | Stream stall timeout 3min | ✅ |
| 26 | MITM JSON cache | 🟦 |
| 27 | MiniMax TTS | ✅ |
| 28 | buildOutput RTK filter | ❌ |
| 29 | bun:sqlite adapter | ✅ |

## Key gaps to consider porting (pod-relevant, no rule conflicts)

1. **#1, #2 — Read tool arg sanitization** in `openai-to-claude.js`. Cheap, targeted fix.
2. **#3 — json_schema fallback for openai-compatible-***. Slot into `executors/default.js` `transformRequest` for `openai-compatible-*` prefix. High value for users routing through custom OpenAI-compat endpoints.
3. **#4 — Codex stream-drop retry**. Wrap upstream fetch in `streamingHandler.js`. Improves Codex stability noticeably.
4. **#7 — Gemini outputDimensionality**. Single-line fix in `embeddingProviders/gemini.js` `buildBody`.
5. **#10 — Connect timeout tuning**. Add `connectTimeout: 20_000` to undici `ProxyAgent` constructions in `proxyFetch.js`. Simple, low-risk.
6. **#28 — buildOutput RTK filter**. New file in `rtk/filters/`, register in `rtk/registry.js`.
7. **#19 — Linux/arm64 Docker**. One-line change in `docker-publish.yml` + remove `--platform=linux/amd64` pin in `Dockerfile`. Test on M-series Macs.
8. **#13, #14, #20 — CF Workers deploy / Deno Deploy / MCP bridge**. Larger features; evaluate user demand before porting.

## Items where pod is ahead of 9router

- **#9** Gemini CLI projectId reuse — pod has dedicated `projectId.js` service with TTL cache + in-flight dedup + abort on disconnect.
- **#12** tokenRefresh dedup — pod has both engine-layer (`open-sse/services/tokenRefresh.js`) and SSE-handler-layer (`src/sse/services/tokenRefresh.js`) dedup.
- **#15** xAI/Grok — pod has both API and web-cookie variants with model-mode mapping for grok-3 through grok-4.20.
- **#22** OAuth callback origin allowlist — pod's implementation is explicitly hardened with documented threat model.
- **#6, #21, #23, #26** MITM-related — pod intentionally removed MITM in v0.0.4; entire class of MITM bugs is N/A by design.

## Notes / risks

- 9router items #5 (Codex 400/404, tool-calling, prompt cache) need commit-level diff inspection — symptoms aren't visible without seeing the upstream patch. Pod's codex executor *deletes* `prompt_cache_retention` and never injects `prompt_cache_key` for chat (only for image gen). If 9router added prompt_cache_key for Codex chat, that may be net-positive to port.
- Item #17 (Kiro RTK compression coverage) needs verification: pod's `compressMessages` runs on body before kiro's `convertMessages` splits history — confirm it actually compresses inside `history[].userInputMessage`, not just the surface body.
- Item #8 (UsageStats setState-in-effect) needs deeper review of `src/shared/components/UsageStats.js` to determine whether pod is affected.
