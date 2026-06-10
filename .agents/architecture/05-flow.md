# Request Flow

This is the high-level path for a typical model request.

## Flow

1. Client calls a Pod API surface.
2. App route validates auth, input, and rate limits.
3. `src/sse` resolves provider, connection, and model intent.
4. `open-sse` translates request shape if needed.
5. Cache and memory logic runs where enabled.
6. Executor calls upstream provider.
7. Response is streamed or normalized back to the client.
8. Usage, logs, and lock state are updated.

## Failure Handling

- Invalid JSON fails early
- Client-facing errors stay sanitized
- Provider auth failures can trigger cooldown/lockout
- Streaming failures must degrade safely
- Retry behavior depends on route and provider rules
