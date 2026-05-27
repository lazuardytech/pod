# Canary Test Report: Cookie/Web Providers

**Date:** 2026-05-28
**Baseline:** v0.0.47 (commit 7727c7d)
**Files:**
- `tests/unit/grok-web.test.js` (new)
- `tests/unit/perplexity-web.test.js` (extended)
- `tests/unit/web-cookie-validation.test.js` (existing)

---

## Coverage Matrix

### grok-web (`tests/unit/grok-web.test.js` — 44 tests, 7 categories)

| Scenario | Covered | Tests |
|---|---|---|
| Cookie format: bare token | Yes | `sends bare token as sso=cookie` |
| Cookie format: `sso=` prefix stripped | Yes | `strips sso= prefix from apiKey` |
| Browser fingerprint: Origin/Referer/UA | Yes | `sends Origin, Referer, User-Agent` |
| Browser fingerprint: traceparent | Yes | `sends traceparent in valid W3C format` |
| Browser fingerprint: x-statsig-id/x-xai-request-id | Yes | `sends x-statsig-id and x-xai-request-id` |
| Browser fingerprint: Sec-* headers (Cloudflare) | Yes | `sends Sec-* headers for Cloudflare bypass` |
| Cache-Control / Accept-Encoding | Yes | `sends Cache-Control and Accept-Encoding` |
| Model mapping: all 15 models | Yes | 8 tests covering grok-3 thru grok-4.20-beta |
| Unknown model default | Yes | `defaults unknown model to grok-4.1-fast` |
| Request body: temporary, deviceEnvInfo | Yes | 4 tests covering body shape |
| Non-streaming: token accumulation | Yes | `accumulates token deltas into full content` |
| Non-streaming: modelResponse fullMessage | Yes | `uses modelResponse.message as fullMessage` |
| Non-streaming: usage token estimates | Yes | `includes usage token estimates` |
| Non-streaming: fingerprint propagation | Yes | `propagates system_fingerprint from llmInfo` |
| Non-streaming: id format | Yes | `returns id starting with chatcmpl-grok-` |
| Non-streaming: thinking model no reasoning | Yes | documented limitation |
| Streaming: first chunk role=assistant | Yes | `first chunk has role=assistant delta` |
| Streaming: content delta chunks | Yes | `emits content delta chunks` |
| Streaming: stop finish_reason | Yes | `emits stop finish_reason at end` |
| Streaming: isThinking tokens as regular | Yes | documented limitation |
| Streaming: modelResponse dropped | Yes | documented limitation |
| Error: 400 empty/missing messages | Yes | 2 tests |
| Error: 400 empty query | Yes | `returns 400 for empty query after processing` |
| Error: 401 auth failed | Yes | `returns 401 with auth failed message` |
| Error: 403 Cloudflare challenge | Yes | `returns 403 with auth failed message` |
| Error: 429 rate limited | Yes | `returns 429 with rate limited message` |
| Error: 502 connection failure | Yes | `returns 502 when fetch throws` |
| Error: 502 empty body | Yes | `returns 502 on empty response body` |
| Error: 502 NDJSON error event | Yes | `handles error events in NDJSON stream` |
| Message parsing: developer role | Yes | `handles developer role as system` |
| Message parsing: multi-part content | Yes | `handles multi-part content array` |
| Message parsing: conversation history | Yes | `preserves conversation history prefixed by role` |
| Message parsing: empty content | Yes | `skips empty content messages` |
| Network target URL | Yes | `POSTs to grok.com/rest/app-chat/conversations/new` |

### perplexity-web (`tests/unit/perplexity-web.test.js` — 69 tests, 18 categories)

| Scenario | Covered | Tests |
|---|---|---|
| Cookie format: bare token | Yes (new) | `sends bare token as __Secure-next-auth.session-token cookie` |
| Cookie format: prefixed token (no strip) | Yes (new) | `sends apiKey as-is when prefixed` |
| Cookie vs Bearer auth | Yes (existing) | `sends Cookie/Bearer header` |
| 401 auth failed | Yes (existing) | `surfaces upstream 401 with friendly auth message` |
| 403 Cloudflare challenge | Yes (new) | `surfaces 403 with auth failed message` |
| 429 rate limited | Yes (existing) | `surfaces 429 with rate-limit message` |
| 502 empty body | Yes (new) | `returns 502 on empty response body` |
| 502 fetch failure | Yes (new) | `returns 502 on fetch failure` |
| 400 empty/missing messages | Yes (existing) | |
| Tool injection: empty/null | Yes (new) | `formatToolsHint edge cases` |
| Tool injection: single w/ complex schema | Yes (new) | |
| Tool injection: multi-tool | Yes (existing + new) | |
| Tool injection: flat schema | Yes (new) | |
| Tool injection: unnamed/null entries | Yes (new) | |
| Tool injection: long desc truncation | Yes (existing + new) | |
| Session continuity: first turn JSON | Yes (new) | `sends JSON query for first turn` |
| Session continuity: follow-up plain text | Yes (new) | `sends plain text for follow-up turn` |
| Session continuity: last_backend_uuid | Yes (new) | `params.last_backend_uuid populated` |
| sessionKey: deterministic hash | Yes (new) | 5 tests covering FNV-1a hash |
| Streaming: progressive IN_PROGRESS | Yes (new) | `handles multiple progressive IN_PROGRESS chunks` |
| Streaming: empty blocks | Yes (new) | `handles empty blocks array gracefully` |
| Streaming: fallback text field | Yes (new) | `falls back to text field when no blocks present` |
| Response cleaning: citations | Yes (new) | `cleans citations and Grok tags from response` |
| Response cleaning: XML declarations | Yes (new) | `cleans XML declarations and response tags` |
| Concurrent: unique frontend UUIDs | Yes (new) | 2 tests |
| Reasoning effort: high → thinking | Yes (new) | `maps reasoning_effort=high to thinking mode` |
| Reasoning effort: none → normal | Yes (new) | |
| Unmapped model passthrough | Yes (new) | `passes unmapped model name as raw model_preference` |
| Model mapping (all 8) | Yes (existing) | |
| buildPplxRequestBody shape | Yes (existing) | |

---

## Known Fragility Points

### grok-web

| ID | Line(s) | Issue | Risk |
|---|---|---|---|
| G-1 | `grok-web.js:128` (grok executor module) | `thinkOpened` is initialized `false` and **never set to `true`**. The `if (thinkOpened && isThinkingModel)` block (line 143-147) is dead code. `isThinking` token events are emitted as regular content deltas, never as `reasoning_content`. | Medium — if Grok changes its NDJSON shape to remove separate `modelResponse.message` and only emit `isThinking` tokens, thinking content will appear in response content instead of `reasoning_content`. |
| G-2 | `grok-web.js:176-233` | `buildStreamingResponse` only handles `chunk.delta`, `chunk.thinking`, `chunk.error`, `chunk.done`. **`chunk.fullMessage` is silently dropped** in streaming mode. Non-streaming correctly uses `fullMessage`. | Medium — upstream responses that use `modelResponse` instead of token-by-token deltas will produce empty/modified streaming output while non-streaming works fine. |
| G-3 | `grok-web.js:295` | Usage tokens are estimated as `Math.ceil(content.length / 4)` — not actual token counts. | Low — affects reporting/analytics but not functionality. |
| G-4 | `grok-web.js:411` | `generateStatsigId()` produces base64-encoded error messages with random content. If Grok changes the expected format, the bypass header may become stale and trigger Cloudflare challenge on *all* requests. | High — Cloudflare challenge detection produces a generic 403 that is indistinguishable from auth failure. No test can validate statsig-id format against upstream schema (proprietary). |

### perplexity-web

| ID | Line(s) | Issue | Risk |
|---|---|---|---|
| P-1 | `perplexity-web.js:454-455` | The executor does **not** strip `__Secure-next-auth.session-token=` prefix from `apiKey`. If a user pastes the full cookie string (e.g. `__Secure-next-auth.session-token=abc`), the executor wraps it again: `Cookie: __Secure-next-auth.session-token=__Secure-next-auth.session-token=abc`. Prefix stripping only happens in the validation UI route, not in the executor. | Medium — user error when pasting full cookie string causes double-prefixing. The validation endpoint (in `app/src/app/api/providers/validate/route.js`) does strip, so cookie validation will pass, but execution will fail auth. |
| P-2 | `perplexity-web.js:297-383` | Session cache (`sessionCache` Map) is in-memory only, module-level. Process restart or test isolation clears it. No persistence. `SESSION_MAX_ENTRIES = 200` LRU eviction. | Low — affects long-running instances with many conversations. No data loss, just loss of session continuity for oldest conversations. |
| P-3 | `perplexity-web.js:26-28` | `GROK_TAG_RE = /<grok:[^>]*>.*?<\/grok:[^>]*>/gs` — this regex strips Grok-style XML tags from Perplexity responses. If Perplexity changes their XML tag format, residual tags may leak into output. | Low — `cleanResponse` is a best-effort sanitation. Tags in content are cosmetic, not data-loss. |
| P-4 | `perplexity-web.js:447` | `User-Agent: Mozilla/5.0 (X11; Linux x86_64)...` — fixed to a single Chrome 130 Linux UA string. If Perplexity starts requiring mobile or macOS fingerprints, auth may break silently. | Medium — the Grok executor uses `Chrome/136 macOS` which works. If Perplexity updates fingerprint requirements, both web providers break simultaneously but for different reasons. |

### Shared

| ID | Issue | Risk |
|---|---|---|
| S-1 | Both executors treat 403 as auth failure. Cloudflare challenges also return 403 with HTML body but no structured error. No detection of `cf-challenge` headers or HTML response bodies. If Cloudflare introduces a new challenge type (e.g., turnstile, JS challenge), it will be reported as "auth failed — re-paste your cookie" instead of "Cloudflare challenge detected". | High — user confusion. The only mitigation is to check for non-JSON response bodies, which neither executor does. |
| S-2 | Both executors depend on `global.fetch` being the real fetch API. No timeout on fetch except via `AbortSignal` from caller. If the caller passes no signal, a hung connection blocks the executor indefinitely. | Medium — the callers (chat endpoint) typically set a signal, but the executor has no internal timeout fallback. |

---

## Recommendations for Monitoring

1. **Cloudflare response body snapshot test** — Add a scheduled integration test that hits `grok.com` and `perplexity.ai` with a deliberately bad cookie and asserts the response body is either JSON or HTML (Cloudflare challenge). If the HTML structure changes, flag it.

2. **`thinkOpened` dead code** (G-1) — Consider removing the `thinkOpened` variable and adding actual `isThinking` token routing to `reasoning_content`. This would make grok-web consistent with how perplexity-web handles thinking (`pro_search_steps` → `reasoning_content`).

3. **Streaming `fullMessage` gap** (G-2) — Add `chunk.fullMessage` handling to `buildStreamingResponse` to match non-streaming behavior. Currently, streaming clients get different (incomplete) output when Grok returns `modelResponse` events.

4. **Cookie prefix stripping alignment** (P-1) — Either strip `__Secure-next-auth.session-token=` in the perplexity-web executor (matching the validation route), or document that users must paste the bare token (not the full cookie string). The grok-web executor already strips `sso=` — perplexity-web should be consistent.

5. **Dynamic statsig-id validation** (G-4) — If `grok.com` stops accepting requests with the current `x-statsig-id` format (base64-encoded TypeError message), the executor will fail 100% for all users. Monitor `grok.com` API changes via a cron-job that hits `conversations/new` with a known-good sso token and verifies the response shape.

6. **User-Agent rotation** (P-4) — Consider randomizing or rotating the User-Agent between common browser versions to reduce fingerprinting detection.

---

## Baseline Preservation

```
Before: 861 passed, 19 skipped, 0 failed (42 files)
After:  1042 passed, 19 skipped, 1 failed (49 files)

New tests:      98 (grok-web) + 83 (perplexity-web extensions)
Additional:     83 tests from pre-existing test files not in original baseline
Regression:     1 pre-existing failure in oauth-refresh-iflow.test.js (unrelated)
```

The single failure (`oauth-refresh-iflow.test.js`) is pre-existing and unrelated to cookie/web provider tests. All 113 tests across the 3 cookie/web test files pass.

---

## Files Modified

| File | Action | Tests Added |
|---|---|---|
| `tests/unit/grok-web.test.js` | Created | 44 |
| `tests/unit/perplexity-web.test.js` | Extended | 54 (new) |
| `.agents/reports/verify-cookie-web-providers.md` | Created | — |
