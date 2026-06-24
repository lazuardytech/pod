# Engine Architecture (open-sse/)

## Purpose

Provider routing, format translation, request/response streaming, and caching. The engine lives in `open-sse/` and is the core that connects upstream LLM providers to the client.

## Key Areas

| Area | Responsibility |
|---|---|
| `config/` | Provider definitions, model catalogs, runtime configuration |
| `executors/` | Provider-specific HTTP clients (default, claude, gemini, openai, vertex, kiro, etc.) |
| `handlers/` | Core chat handler with streaming and non-streaming paths |
| `services/` | Model resolution, provider metadata, credential management |
| `translator/` | Request/response format translation between OpenAI, Claude, Gemini, and others |
| `utils/` | Stream processing, error handling, shared helpers |

## Streaming Flow

```
SSE from provider → TransformStream → translator pipeline → client
```

Each response chunk passes through a TransformStream that applies format translation (e.g., Claude's streaming format to OpenAI-compatible chunks) before reaching the client.

## Claude-to-OpenAI Thinking Fix

Claude streaming uses `thinking_delta` events. The translator converts these to OpenAI-compatible `reasoning_content` deltas and strips `<think>`/`</think>` markers from the final content.

## Invariants

- **Crash guards**: `open-sse/utils/stream.js` and `open-sse/handlers/chatCore.js` each wrap their execution in try/catch to prevent a single provider failure from killing the process.
- **Guarded peek-reader**: `open-sse/handlers/chatCore.js` uses a peek-reader pattern that safely inspects the first chunk without consuming the stream, protected by crash guard.
- **SSE connection cap**: 100 concurrent SSE connections maximum.
- **Idle timeout**: SSE connections idle for 5 minutes are terminated.
- **Connection locking**: Model-level concurrency control via `modelLockCount_${model}` semantics, enforced with transactional writes.
