# OpenAI-Compatible API Production-Readiness Fix Plan

Status: shipped on canary (v0.0.86) · Branch: canary
Audited: 2026-07-11 via code review + live black-box tests against https://pod.lazuardy.tech/v1

## Method

1. Code review of `src/` + `open-sse/` (typed local fork).
2. Live cross-check: every finding re-tested directly against production with a real API key.
3. Findings confirmed/refuted from production evidence before planning fixes.

## Production cross-check results (verdict per finding)

| #   | Finding                                                                            | Prod status                                                 |
| --- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| F0  | Models shape + `general` present                                                   | CONFIRM (already correct)                                   |
| F1  | `/v1/responses` non-stream returns `chat.completion` (not `response`)              | CONFIRM - SDK breaker                                       |
| F2  | Responses params (`previous_response_id`/store/truncation/include) silent no-op    | CONFIRM                                                     |
| F3  | TTS `voice`/`speed` dropped; `response_format` read from query not body            | Code-level (no TTS model on prod - untestable live)         |
| F4  | `/translations` == `/transcriptions` (no translate logic, `language` not stripped) | Code-level (no STT model on prod - untestable live)         |
| F5  | Files `DELETE` lies (200 for ghost); POST 501; `/content` exists (404)             | CONFIRM (partial: `/content` present)                       |
| F6  | No `x-ratelimit-*` headers / no `Retry-After`                                      | CONFIRM                                                     |
| F7  | Moderations mock false-negative                                                    | CONFIRM (acceptable per matrix "Mock")                      |
| F8  | Raw upstream leak in `error.message`                                               | Refuted literal; topology leak (`provider: openai`) remains |

## Fixes

### F1 - Responses non-streaming shape (PRIORITY / breaker)

- File: `src/app/api/v1/responses/route.ts` (only this file; open-sse untouched).
- Add a local helper `chatCompletionToResponse(cc, fallbackId)` that maps `object:"chat.completion"` -> `object:"response"` with `id:"resp_"+cc.id`, `output:[{type:"message", content:[{type:"output_text", text}]}]`, and `usage` mapped to `input_tokens`/`output_tokens`/`total_tokens`.
- In `POST`, read body once via `readBodyTextStream` to detect `stream`. If `!stream`, call `handleChat`, then convert the JSON response with the helper.
- `handleResponsesCore` in `open-sse/handlers/responsesHandler.ts` is confirmed dead code and does NOT build the shape - do not wire it in (Option B chosen: shortest correct).
- Verification: `POST /v1/responses {"stream":false}` -> `object:"response"`, `output[0].type=="message"`.

### F2 - Responses ignored params

- File: `src/app/api/v1/responses/route.ts`.
- Keep silent-ignore for `store`/`truncation`/`include`/`reasoning` (already stripped in `openai-responses.ts`; fine for a gateway).
- If `previous_response_id` is present and non-empty -> return `400 {"code":"invalid_request_error","message":"previous_response not found"}` (Pod stores nothing).
- Verification: `POST` with `previous_response_id` -> `400`.

### F5 - Files DELETE integrity

- File: `src/app/api/v1/files/[file_id]/route.ts` (DELETE handler, ~lines 53-60).
- Replace unconditional `200 {deleted:true}` with the same `404 file_not_found` shape the GET handler already uses. Pod has no file storage, so 404 for all ids is the honest contract.
- `POST /v1/files` (501) and `/content` (404) need no change.
- Verification: `DELETE /v1/files/ghost` -> `404`.

### F7 - Moderations

- No code change. Keep `flagged:false` passthrough stub (already labeled "Mock" in matrix). Switching to 501 would break OpenAI-compatible clients expecting the endpoint. Document only.

### F6 - Rate-limit headers + CORS expose

- `src/lib/rateLimit/redis.ts` (~line 103) and `memory.ts` (~line 104): return `remaining` + `resetSeconds` alongside `ok`.
- `src/lib/rateLimit/index.ts`: add one helper `attachRateLimitHeaders(res, {limit, remaining, reset})` emitting `x-ratelimit-limit-requests`, `x-ratelimit-remaining-requests`, `x-ratelimit-reset-requests`; also add these 3 headers to `rateLimitResponse()` (429 path). Apply helper in both success return sites (redis + memory) only when `config` exists.
- Token-based headers omitted (Pod tracks RPM + concurrent only, not tokens) - honest minimal set.
- `open-sse/utils/error.ts` (~line 35): add `Access-Control-Expose-Headers: Retry-After, x-ratelimit-limit-requests, x-ratelimit-remaining-requests, x-ratelimit-reset-requests` to the shared error header block so browsers can read them.
- Verification: `curl -D - /v1/chat/completions` -> 3 `x-ratelimit-*` headers present.

### F8 - Sanitize topology leak

- Files: `src/sse/handlers/chat.ts` (~277), `search.ts` (~174), `fetch.ts` (~176).
- Replace `"No active credentials for provider: ${provider}"` / `"No credentials for provider: ${providerId}"` with generic `"Model not found"` / `"Model not available"`. Keep `type`/`code` (e.g. `model_not_found`); only the message is genericized.
- Verification: unknown model -> `404 {"message":"Model not found"}` (no provider name).

### F3 - TTS body params (code-level; needs capable provider to verify)

- `src/sse/handlers/tts.ts` (~47-53): read `response_format` from **body** (fallback query), and read `voice` + `speed` from body. Forward to `handleTtsCore`.
- `open-sse/handlers/ttsCore.ts` (~51-58): add `voice`/`speed` to destructure; pass to adapter `synthesize(..., {language, voice, speed})`.
- `open-sse/handlers/ttsProviders/{index,openai,openrouter,gemini}.ts`: honor `opts.voice` (override suffix) and `opts.speed`; others ignore `speed` (YAGNI).
- Verification requires a TTS-capable provider (e.g. OpenAI `tts-1`) configured; send `{"voice":"alloy","speed":1.2,"response_format":"opus"}` and assert honored.

### F4 - Translations distinct from transcriptions (code-level; needs capable provider)

- `src/app/api/v1/audio/translations/route.ts` (~21): call `handleStt(request, {translate:true})`.
- `src/sse/handlers/stt.ts` (~23): thread `translate`; when set, restrict to whisper-1 and `formData.delete("language")`.
- `open-sse/handlers/sttCore.ts` (~218): accept `translate`; on OpenAI-compatible path skip `language` (whisper translates to English by default). Deepgram/Gemini lack true translation - document as partial.
- Verification requires whisper-1-capable provider; assert English output and `language` dropped.

## Execution order

1. F1 + F2 (one file, highest impact) - breaker fix.
2. F5 (one file, honesty fix).
3. F6 + F8 (shared helpers + leak sanitize).
4. F3 + F4 (code-level; verify only when a capable provider is configured).
5. F7 - no change (document).

## Verification gate (per AGENTS.md)

```
bun run check     # oxfmt + oxlint + tsc --noEmit
bun run test:run  # vitest run
bun run build     # NODE_ENV=production next build
```

Then re-run the production curl cross-checks above against the Zeabur canary deploy and confirm each fixed finding flips to CONFIRM.

## Notes

- F0 confirmed correct - no action.
- F3/F4 are real code defects but cannot be exercised on the current deployment (no audio-capable provider). Fix is still worth landing for correctness; mark verification as blocked-on-provider-config.
- `open-sse/` is TypeScript and included in root `tsc`; update typed exports directly if signatures change.
