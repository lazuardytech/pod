# API Compatibility Matrix

OpenAI-compatible and Anthropic-compatible behavior is Pod's primary sacred objective.

## OpenAI Compatibility

| Endpoint                        | Status    | Notes                                                                                  |
| ------------------------------- | --------- | -------------------------------------------------------------------------------------- |
| `GET /v1/models`                | Supported | CORS, auth, JSON shape                                                                 |
| `GET /v1/models/{slug}`         | Supported | Single model lookup                                                                    |
| `POST /v1/chat/completions`     | Supported | Streaming + non-streaming, tools, JSON mode                                            |
| `POST /v1/responses`            | Supported | Maps to same handler as chat; CORS on non-streaming; `400` on unsupported shapes       |
| `POST /v1/responses/compact`    | Supported | Compact mode flag                                                                      |
| `POST /v1/embeddings`           | Supported |                                                                                        |
| `POST /v1/audio/speech`         | Supported | TTS passthrough                                                                        |
| `POST /v1/audio/transcriptions` | Supported | STT passthrough                                                                        |
| `POST /v1/audio/translations`   | Supported | Same as transcriptions                                                                 |
| `POST /v1/images/generations`   | Supported | Passthrough to provider                                                                |
| `POST /v1/images/edits`         | **501**   | Not implemented. Still `withApiKeyRateLimit`                                           |
| `POST /v1/images/variations`    | **501**   | Not implemented. Still `withApiKeyRateLimit`                                           |
| `POST /v1/moderations`          | Supported | Mock — always unflagged                                                                |
| `GET /v1/files`                 | Supported | Empty list. **Always requires API key** (even if `requireApiKey=false`). Rate-limited. |
| `POST /v1/files`                | **501**   | Not implemented. `withApiKeyRateLimit`; key required only when `requireApiKey`         |
| `GET /v1/files/{file_id}`       | Supported | 404 `file_not_found`. **Always requires API key**                                      |
| `DELETE /v1/files/{file_id}`    | Supported | 404 `file_not_found` (no file store). **Always requires API key**                      |
| `GET /v1beta/models`            | Supported | Gemini-compatible model list; honors `requireApiKey`                                   |
| `GET /v1beta/models/{path}`     | Supported | Gemini-compatible model detail                                                         |
| `POST /v1/web/fetch`            | Supported | Web fetch utility                                                                      |
| `POST /v1/search`               | Supported | Web search utility                                                                     |

### OpenAI Error Shape

Errors return `{ error: { message, type, param, code } }` with appropriate HTTP status (400, 401, 404, 429, 500).

### Partially Supported

- `stream_options.include_usage` — handled in `open-sse/utils/stream.ts`, injects estimated usage on finish chunk
- `response_format` — json_schema/json_object supported via translator, route-level schema validation not tested
- `tool_choice` — `auto`, `none`, `required` supported; named function choice passes through
- `max_completion_tokens` vs `max_tokens` — both accepted; `max_tokens` used internally, `max_completion_tokens` passed through for reasoning models

### Not Supported

- Assistant API (`/v1/assistants`)
- Batch API (`/v1/batches`)
- Fine-tuning API
- Realtime API

## Anthropic Compatibility

| Endpoint                         | Status    | Notes                                                 |
| -------------------------------- | --------- | ----------------------------------------------------- |
| `POST /v1/messages`              | Supported | Auto-detects Claude format, routes through translator |
| `POST /v1/messages/count_tokens` | Supported | Char-based estimate, not real tokenization            |

### Anthropic Error Shape

Errors return OpenAI `{ error: { message, type, param, code } }` format. The `/v1/messages` route has catch blocks returning Anthropic format, but errors from `handleChat` core are still OpenAI-format. Works with Anthropic SDKs but not spec-compliant.

### Anthropic-Specific Features

- `anthropic-version` header — passthrough
- `anthropic-beta` header — passthrough
- `thinking` block — supported via translator (Claude → OpenAI → Claude)
- Tool use (`tool_use` blocks) — supported
- Streaming — supported (SSE with content_block_delta, content_block_start, etc.)
- `metadata` — passed through

### Not Supported

- Message batches
- Anthropic admin API
- Real token counting (inaccurate char-based estimate)

## Auth

| Behavior                                   | Status                                         |
| ------------------------------------------ | ---------------------------------------------- |
| API key via `Authorization: Bearer` header | Supported                                      |
| API key via `x-api-key` header             | Supported                                      |
| API key via query param                    | Not supported                                  |
| API key validation                         | Required by default via `requireApiKey` config |

## Streaming

- SSE with `text/event-stream` content type
- OpenAI format: `data: { choices: [{ delta: { content } }] }`
- Anthropic format: `data: { type: "content_block_delta", delta: { text } }`
- Error handling during stream returns structured JSON error
- 5-minute idle timeout, 100-connection cap

## SDK/Client Compatibility

| Client              | Chat Completions | Streaming | Tools | Embeddings | Images | Audio |
| ------------------- | ---------------- | --------- | ----- | ---------- | ------ | ----- |
| openai (Python)     | ✓                | ✓         | ✓     | ✓          | ✓      | ✓     |
| openai (Node.js)    | ✓                | ✓         | ✓     | ✓          | ✓      | ✓     |
| anthropic (Python)  | ✓                | ✓         | ✓     | —          | —      | —     |
| anthropic (Node.js) | ✓                | ✓         | ✓     | —          | —      | —     |
| OpenAI SDK (JS)     | ✓                | ✓         | ✓     | ✓          | ✓      | ✓     |
| Vercel AI SDK       | ✓                | ✓         | ✓     | ✓          | —      | —     |
| LangChain           | ✓                | ✓         | ✓     | ✓          | —      | —     |

Testing status: route-contract tests cover chat completions, responses, embeddings, models, and messages. Streaming format parsing has extensive unit coverage. No full end-to-end HTTP test suite against deployed instance.

## Verification

Compatibility verified against:

- OpenAI API Reference (platform.openai.com/docs/api-reference/chat)
- Anthropic Messages API (docs.anthropic.com/en/api/messages)
- Existing route contract tests under tests/unit/
- Response parsing tests in tests/unit/

## Version

Last reviewed: 2026-07-24 | Pod v0.0.82
