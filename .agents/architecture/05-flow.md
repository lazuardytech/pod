# Request Flow

## Streaming Chat Completion

```
Client POST /v1/chat/completions
  -> API route (rate limit, auth, sanitizeError)
  -> src/sse/ (model resolution, combo logic, connection cap)
  -> open-sse engine (format translation -> executor dispatch -> upstream)
  -> TransformStream (response translation)
  -> client (OpenAI-compatible SSE chunks)
```

### Step by step

1. **API route**: Applies rate limiting via `src/lib/rateLimit/`, auth via `requireApiKey`. Returns `sanitizeError` on failure. Parses body via `parseJsonBody`.

2. **SSE handler** (`src/sse/handlers/chat.js`): Resolves model against provider config. Handles combo logic (fallback chains, round-robin). Enforces 100-connection cap and 5-minute idle timeout. Manages `modelLockCount_${model}` concurrency.

3. **open-sse engine**: Translates request to provider-native format. Dispatches to the correct executor. Pipes streaming response through TransformStream for format translation back to client format.

4. **Client**: Receives OpenAI-compatible SSE chunks with `choices[].delta.content` and optionally `choices[].delta.reasoning_content`.

## Thinking Block Path

```
Claude upstream -> thinking_delta events -> claude-to-openai translator -> reasoning_content delta -> client
```

The translator converts Claude's `thinking_delta` into OpenAI-compatible `reasoning_content` fields and strips `<thinking>`/`</thinking>` markers from content deltas.

## Non-Streaming

```
Client POST -> API route -> SSE handler -> engine -> provider SSE -> collect all chunks -> JSON response -> client
```

Non-streaming requests internally use the streaming path, collect all chunks, and return a single JSON response.

## Combo Fallback

```
Primary model/provider -> failure -> check combo config -> fallback model/provider -> retry
```

Combos define model groups with fallback and round-robin strategies. When a provider fails, the handler follows the fallback chain within the same request.

## Failure Handling

| Failure type | Response |
|-------------|----------|
| Upstream error before streaming | Structured JSON error via `sanitizeError` |
| Mid-stream failure | Graceful degradation (connection closes cleanly) |
| Rate limit / overload | Provider cooldown with exponential backoff |
| Auth failure | Early rejection before reaching provider |
| Vercel relay 502/504 | Retry once (timeout = pod timeout - 5s) |
| Kiro transient overload | Body-gated retry on overload markers |
| Raw upstream error body | Never returned to client (leak prevention) |

## Observability

Request details are captured per-request and stored in SQLite:
- Timestamps, latency, status codes
- Provider, model, token counts
- Configurable via `OBSERVABILITY_*` env vars
- Batched writes for performance
