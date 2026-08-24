# Engine Architecture (`open-sse/`)

The open-sse engine is a local fork (never the npm package) that handles provider routing, format translation, request/response streaming, and error recovery. It is Pod's core — everything else delegates to it.

## Directory Layout

```
open-sse/
  config/           Provider definitions, model catalogs, runtime constants
  executors/        20 files: 17 specialized + default.ts + base.ts + index.ts
  handlers/         Core chat handler: streaming and non-streaming paths
  services/         Combo fallback/RR, Fusion panel+judge, capacity adapter, token refresh
  transformer/      Response transformation utilities
  translator/       Request/response format translation + thinkingUnified
  utils/            Stream processing, error handling, proxy fetch patch
  rtk/              RTK tool_result compression, Headroom client, Caveman/Ponytail inject
  providers/        Capability resolver (modalities + thinkingFormat overlay)
  index.ts          Public API surface — re-exports for src/sse/ consumers
```

## Executor Types

Each provider gets its own executor in `open-sse/executors/`. They share a common interface so the handler dispatches generically.

| Executor                                                                                                                                                                                          | Notable behavior                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `default.ts`                                                                                                                                                                                      | Handles most OpenAI-compatible providers           |
| `vertex.ts`                                                                                                                                                                                       | GCP auth + strips `stream` field from request body |
| `kiro.ts`                                                                                                                                                                                         | Transient overload body-gating for retry           |
| `ollama-local.ts`                                                                                                                                                                                 | Local Ollama endpoint                              |
| `codex.ts`                                                                                                                                                                                        | Codex reasoning token budget normalization         |
| `antigravity.ts`, `cursor.ts`, `github.ts`, `grok-web.ts`, `iflow.ts`, `qoder.ts`, `qwen.ts`, `opencode.ts`, `opencode-go.ts`, `commandcode.ts`, `gemini-cli.ts`, `perplexity-web.ts`, `azure.ts` | Provider-specific quirks isolated per executor     |

## Translator Pipeline

`open-sse/translator/` translates between provider-native formats and the client-expected format using TransformStream pipelines.

| Path         | What it does                                          |
| ------------ | ----------------------------------------------------- |
| `request/`   | Client request → provider-native format               |
| `response/`  | Provider-native response → OpenAI-compatible format   |
| `formats.ts` | Format constants (`openai`, `claude`, `gemini`, etc.) |
| `helpers/`   | Shared translation utilities                          |

### Claude-to-OpenAI Thinking Fix

Claude streaming sends `thinking_delta` events. The translator:

1. Converts `thinking_delta` → OpenAI `reasoning_content` delta
2. Strips `<think>`/`</think>` markers from the final content delta
3. Never emits `<think>`/`</think>` as content — this is an invariant

## Streaming Flow

```
Client → API route → src/sse/ (orchestration) → open-sse engine
  → format translation (request) → executor dispatch → upstream provider
  → TransformStream (response translation) → client
```

Each streaming response chunk passes through a TransformStream that applies format translation before reaching the client.

## Invariants

| Rule                                                         | Where enforced                                  |
| ------------------------------------------------------------ | ----------------------------------------------- |
| SSE connection cap: 100 concurrent                           | `src/sse/handlers/chat.ts`                      |
| SSE stream stall timeout: 5 minutes                          | `open-sse/utils/stream.ts` (`STALL_TIMEOUT_MS`) |
| Crash guard around stream processing                         | `open-sse/utils/stream.ts`                      |
| Crash guard around chat core                                 | `open-sse/handlers/chatCore.ts`                 |
| Guarded peek-reader (inspect first chunk without consuming)  | `open-sse/handlers/chatCore.ts`                 |
| Transactional connection locking (`modelLockCount_${model}`) | `open-sse/services/accountFallback.ts`          |
| Guarded fallback loop                                        | `src/sse/handlers/chat.ts`                      |

These guards are non-negotiable. Removing or weakening any of them risks process crashes or stream corruption.

## Error Handling

- **Upstream error before streaming**: Return structured JSON error immediately
- **Mid-stream failure**: Degrade gracefully, never crash the process
- **Client disconnect**: `AbortError` at `node:_http_server` (client disconnect) is classified as `[ClientDisconnect]`, not `[FATAL]`; SSE stream wrappers call `controller.close()` (not `controller.error(err)`) on reader abort
- **Raw upstream bodies never leak**: `sanitizeError()` strips internal details
