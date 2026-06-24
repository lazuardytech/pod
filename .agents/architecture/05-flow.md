# Request Flow

## Streaming Chat Completion

```
Client POST /v1/chat/completions
  → API route (rate limit, auth check)
  → chat handler (model resolution, combo logic)
  → open-sse engine (format translation, executor dispatch)
  → upstream provider API
  → streaming response via TransformStream
  → client
```

1. **API route** (`/v1/chat/completions`): Applies rate limiting via `src/lib/rateLimit/` and auth via `requireApiKey`. Returns `sanitizeError` on failure.

2. **Chat handler** (`src/sse/handlers/chat.js`): Resolves the requested model against provider configuration, handles combo model logic (e.g., routing certain models to specific providers), and sets up the SSE connection with a 100-connection cap and 5-minute idle timeout.

3. **Open-sse engine**: Applies format translation (request → provider-native format), dispatches to the correct executor, and pipes the streaming response through a TransformStream that translates the provider's native format back to the client's expected format.

4. **Client**: Receives OpenAI-compatible SSE chunks with `choices[].delta.content` and optionally `choices[].delta.reasoning_content`.

## Thinking Block Path

```
Upstream provider (Claude)
  → Claude thinking_delta events
  → claude-to-openai translator
  → reasoning_content delta
  → client
```

When a provider (notably Claude) sends thinking blocks as streaming events, the translator converts `thinking_delta` into OpenAI-compatible `reasoning_content` fields in the delta, and strips `<think>`/`</think>` markers from the final content.

## Non-Streaming

```
Provider SSE → SSE-to-JSON converter → JSON response → client
```

Non-streaming requests internally use the streaming path (provider SSE), collect all chunks, and convert to a single JSON response.

## Failure Handling

- **Early JSON error**: If the upstream returns an error before streaming begins, return a structured JSON error immediately.
- **Sanitized error**: Raw upstream error bodies are never returned to the client. `sanitizeError()` strips internal details.
- **Provider cooldown/lockout**: Rate limit or overload errors trigger a provider cooldown to prevent immediate retries.
- **Safe stream degradation**: If streaming fails mid-response, the connection degrades gracefully rather than crashing.
- **Route-specific retry**: Vercel relay retries once on `502`/`504`. Kiro retries are body-gated on transient overload markers. Other providers follow their own retry policies defined in executor config.
