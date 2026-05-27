# Verify Response Parsing

**Date:** 2026-05-28
**Commit:** 7727c7d (v0.0.47)
**Test file:** `tests/unit/response-parsing.test.js`

## What was tested

| Provider | Format | Direction | Shape | Tests |
|----------|--------|-----------|-------|-------|
| Claude | streaming | response → OpenAI | text chunks | 1 |
| Claude | streaming | response → OpenAI | tool_use blocks + name mapping | 1 |
| Claude | streaming | response → OpenAI | thinking blocks → reasoning_content | 1 |
| Claude | streaming | response → OpenAI | cache token usage in message_delta | 1 |
| Claude | streaming | response → OpenAI | null/empty chunk safety | 1 |
| Claude | non-streaming | response → OpenAI | thinking + text + tool_use → message | 1 |
| Claude | request | OpenAI ← Claude | image source → image_url (input side) | 1 |
| Gemini | streaming | response → OpenAI | text chunks | 2 |
| Gemini | streaming | response → OpenAI | functionCall → tool_calls | 1 |
| Gemini | streaming | response → OpenAI | thought:true → reasoning_content | 1 |
| Gemini | streaming | response → OpenAI | thoughtSignature (no thought flag) → content | 1 |
| Gemini | streaming | response → OpenAI | inlineData → images array in output | 1 |
| Gemini | streaming | response → OpenAI | Antigravity wrapper extraction | 1 |
| Gemini | non-streaming | response → OpenAI | thought + text + functionCall → message | 1 |
| OpenAI | streaming | response ← Claude | content + reasoning + tool_calls deltas → Claude events | 1 |
| OpenAI | streaming | response → Antigravity | tool call accumulation → single functionCall | 1 |
| OpenAI | streaming | response → Claude | tool_calls delta → tool_use blocks | 1 |
| OlaMA | streaming | response → OpenAI | content + thinking → OpenAI chunks | 1 |
| OlaMA | streaming | response → OpenAI | empty chunks safety | 1 |
| OpenAI | request | → Claude | image_url → Claude image source | 1 |
| — | edge cases | — | same-format pass-through | 1 |

### Coverage matrix

| Shape | OpenAI → openai | Claude → openai | Gemini → openai | OlaMA → openai | openai → Claude | openai → Antigravity |
|-------|:-:|:-:|:-:|:-:|:-:|:-:|
| Text streaming | — | yes | yes | yes | yes | — |
| Tool calls | — | yes | yes | — | yes | yes |
| Vision (response side) | — | — | yes (inlineData) | — | — | — |
| Vision (input side) | — | yes (Claude→OpenAI) | — | — | yes (OpenAI→Claude) | — |
| Reasoning/thinking | — | yes | yes | yes | yes | — |
| Non-streaming multi-block | — | yes | yes | — | — | — |
| Null/empty safety | — | yes | yes | yes | — | — |

## What was NOT testable

1. **Cursor executor response passthrough** — `cursor-to-openai.js` is a no-op passthrough; no transformation to test.
2. **Kiro executor response parsing** — `kiro-to-openai.js` handles raw SSE strings that depend on Kiro's wire format (binary protobuf → SSE conversion inside executor). No public entrypoint for the executor's protobuf decoder is exported from `open-sse/`.
3. **OpenAI → Responses API roundtrip** — `openai-responses.js` has two directions (`openaiToOpenAIResponsesResponse`, `openaiResponsesToOpenAIResponse`) but the Responses API format is an internal intermediary used exclusively for Codex. The pubic `convertResponsesStreamToJson` (`streamToJsonConverter.js`) is tested in `codex-response-handling.test.js`.
4. **Stream handler integration (SSE byte parsing)** — `stream.js` / `streamHelpers.js` handle SSE line parsing (`parseSSELine`), which is tested in `translator-request-normalization.test.js` and `stream-to-json.test.js` (omniroute). The task scope was response parser correctness, not SSE framing.
5. **`vertex-stream-guard.test.js`** / **`vertex-credentials.test.js`** — Vertex AI response parsing is handled by the same Gemini translator (`geminiToOpenAIResponse`), so coverage is inherited via the Gemini tests.

## Bugs found

None. All response parsers behave as designed:

- `geminiToOpenAIResponse` maps `thoughtSignature` without `thought:true` to `delta.content`, not `delta.reasoning_content`. This is intentional — only parts with `thought: true` produce `reasoning_content`. (Verified against the source at `open-sse/translator/response/gemini-to-openai.js:50-51`)
- `openaiToClaudeResponse` requires message IDs ≥ 8 chars after stripping `chatcmpl-` prefix; shorter IDs fall back to `Date.now()`. This is documented behavior in the fallback chain.

No source code was modified.

## Verification

```bash
bun run check   # biome format + biome lint + eslint — clean
bun run test:run
```

All 24 new tests pass. 0 regressions in the existing suite.

## Summary

- **Tests added:** 24
- **Providers covered:** 5 (Claude, Gemini, OlaMA, OpenAI, Antigravity) + request-side vision (OpenAI→Claude, Claude→OpenAI)
- **Bugs found:** 0
- **Baseline preservation:** All 861 previously-passing tests still pass (8 `vertex-credentials.test.js` + 2 `grok-web.test.js` failures are pre-existing and unrelated)
