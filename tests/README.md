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

| File                                   | What it tests                                                                           |
| -------------------------------------- | --------------------------------------------------------------------------------------- |
| `unit/embeddingsCore.test.ts`          | `open-sse/handlers/embeddingsCore.ts` — body builder, URL router, headers, handler flow |
| `unit/embeddings.cloud.test.ts`        | `cloud/src/handlers/embeddings.ts` — auth, validation, rate limits, CORS                |
| `unit/antigravity-cache.test.ts`       | Mocked AG cache harness (content-keyed `cachedContentTokenCount`)                       |
| `unit/rtk.test.ts`                     | RTK filters + `compressMessages` including Responses `function_call_output`             |
| `unit/rtk-translator-compress.test.ts` | `translateRequest` then `compressMessages` per provider route                           |
| `live/*`                               | Real Google / live Pod; `bun run test:live` only                                        |

## Coverage Summary (59 tests)

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
