# Pod Tests

Default suite is always-on unit/smoke tests. Live Google Antigravity and localhost RTK harnesses live in `tests/live/` and are **not** collected by `bun run test:run`.

## Running Tests

```bash
# Default: Node ≥ 22.18 on PATH (not bun). Expect 0 skipped.
export PATH="$HOME/.nvm/versions/node/v22.22.2/bin:$PATH"   # Cloud / nvm hosts
bun run test:run
```

Live (optional, not CI):

```bash
AG_CACHE_TEST=1 bun run test:live          # real Antigravity OAuth + generateContent
RUN_E2E=1 RTK_E2E_PORT=20128 RTK_E2E_KEY=... RTK_E2E_LOG=/path/to/server.log bun run test:live
```

| Env               | Used by                                | Purpose                              |
| ----------------- | -------------------------------------- | ------------------------------------ |
| `AG_CACHE_TEST=1` | `tests/live/antigravity-cache.test.ts` | Real Google cache                    |
| `RUN_E2E=1`       | `tests/live/rtk*.test.ts`              | Hit local Pod                        |
| `RTK_E2E_PORT`    | default `20128`                        | Live server port                     |
| `RTK_E2E_KEY`     |                                        | API key                              |
| `RTK_E2E_LOG`     |                                        | Server stdout file for `[RTK]` lines |

Embeddings subset:

```bash
bun run test:run -- tests/unit/embeddingsCore.test.ts tests/unit/embeddings.cloud.test.ts
```

## Test Files

| File                                    | What it tests                                                                           |
| --------------------------------------- | --------------------------------------------------------------------------------------- |
| `unit/embeddingsCore.test.ts`           | `open-sse/handlers/embeddingsCore.ts` — body builder, URL router, headers, handler flow |
| `unit/embeddings.cloud.test.ts`         | `cloud/src/handlers/embeddings.ts` — auth, validation, rate limits, CORS                |
| `unit/antigravity-cache.test.ts`        | Mocked AG cache harness (content-keyed `cachedContentTokenCount`)                       |
| `unit/rtk.test.ts`                      | RTK filters + `compressMessages` including Responses `function_call_output`             |
| `unit/rtk-translator-compress.test.ts`  | `translateRequest` then `compressMessages` per provider route                           |
| `unit/redis-rate-limit-backend.test.ts` | `src/lib/rateLimit/redis.ts` — sliding-window RPM, concurrent permits, timeouts         |
| `unit/web-fetch-handler.test.ts`        | `open-sse/handlers/fetch` — firecrawl/jina/tavily/exa dispatch, errors, truncation      |
| `unit/sse-connection-cap.test.ts`       | `src/app/api/monitoring/_sseConnectionCap.ts` — 100-connection cap + 503 overload       |
| `unit/anthropic-error-response.test.ts` | `src/lib/anthropicError.ts` — Anthropic error taxonomy + headers                        |
| `live/*`                                | Real Google / live Pod; `bun run test:live` only                                        |

## Coverage Summary (107 tests)

### `embeddingsCore.test.ts` (36 tests)

- `buildEmbeddingsBody`: single string, array, encoding_format, default float
- `buildEmbeddingsUrl`: openai, openrouter, openai-compatible-\*, unsupported providers
- `buildEmbeddingsHeaders`: per-provider header sets, fallback to accessToken
- `handleEmbeddingsCore` input validation: missing, wrong type, null, empty
- `handleEmbeddingsCore` success: response format, CORS, Content-Type, callbacks
- `handleEmbeddingsCore` errors: 400/429/500, network error, invalid JSON
- `handleEmbeddingsCore` token refresh: 401 retry, graceful fallback

### `embeddings.cloud.test.ts` (23 tests)

- CORS OPTIONS: 200 response, empty body, correct headers
- Authentication: missing key, bad format, old-format key, wrong key value, valid key
- Body validation: invalid JSON, missing model, missing input, bad model
- Happy path: single string, array, correct delegation, CORS header, machineId override
- Rate limiting: all accounts rate-limited → 503 + Retry-After, no credentials → 400
- Error propagation: non-fallback errors passed through, 429 exhausts accounts
- machineId override: validates key, rejects wrong key

### `redis-rate-limit-backend.test.ts` (14 tests)

- Sliding-window RPM: permit under limit, deny at/over limit with retry-after, unique same-ms members, reset math
- Cleanup ops (`zremrangebyscore`/`zcard`/`expire`/`zadd`/`zrange`) and error envelopes on Redis failures
- `releaseRpm`: exact member via `zrem`, newest-entry fallback via `zpopmax`, no-op when disconnected
- Concurrent permits: grant + idempotent release, deny-and-decrement over max, expire-failure DECR undo
- Redis op timeout wraps into a fail-closed `error` envelope

### `web-fetch-handler.test.ts` (17 tests)

- Validation: missing `url`, missing `provider`, unsupported provider
- Firecrawl: POST shape + bearer auth, markdown/html/text fallback, title, truncation, upstream error passthrough, malformed JSON fallback
- Jina: URL encoding, GET + bearer, H1 title parsing, error body slice, no auth when credentialless
- Tavily/Exa: request bodies, header styles (`authorization` vs `x-api-key`), first-result mapping
- Transport: timeout → 504, network failure → 502

### `sse-connection-cap.test.ts` (5 tests)

- 100 concurrent slots allowed, 101st rejected with 503 + Retry-After
- Slot release frees capacity; per-route counters; release past zero tolerated

### `anthropic-error-response.test.ts` (12 tests)

- Status → Anthropic error type mapping (10 statuses), unmapped → `api_error`
- Response shape, `anthropic-version` header, CORS headers
