# Providers and Routing

## Provider Sources

- Transport config: `open-sse/config/providers.js` (50+ providers, OAuth endpoints, auth methods)
- Model mapping: `open-sse/config/providerModels.js` (all models grouped by alias)
- Error/retry behavior: `open-sse/config/errorConfig.js` (text rules, status rules, exponential backoff)
- Dashboard metadata: `src/shared/constants/providers.js`

## Provider Alias System

Common aliases resolved via `ALIAS_TO_PROVIDER_ID`:
- `cc` → claude, `cx` → codex, `gc` → gemini-cli, `qw` → qwen
- `if` → iflow, `ag` → antigravity, `gh` → github, `kr` → kiro, `cu` → cursor
- Direct IDs: openai, deepseek, groq, etc. — pass through unchanged

## Routing Model

1. `parseModel()` splits on `/` → `{ providerOrAlias, model }`
2. `resolveProviderAlias()` maps alias → provider ID
3. Resolve model alias and combo strategy
4. Pick eligible credential/account (`getProviderCredentials`)
5. Filter locked accounts (connection-level + model-level)
6. Execute provider call via specialized or default executor
7. On retryable failure: lock account/model, try next candidate

## Provider-Specific Invariants

- Built-in providers cannot be renamed; custom-node-only (`openai-compatible-*`, `anthropic-compatible-*`, `custom-embedding-*`)
- Vertex AI body must never include `stream`
- Vercel relay: timeout = pod timeout − 5s, retry once on 502/504, health test via `google.com/generate_204`
- Kiro transient retry is body-gated (`MODEL_TEMPORARILY_UNAVAILABLE`), not generic 500
- Codex: overloaded-stream single-reader peek, reasoning-effort normalization (`extra-high`/`very-high` → `xhigh`), output_index remapping to zero-based, tool call response cut-off fix, assistant role continuation prevention
- Cloud worker must keep `testClaude.js` stub (410 response)

## Fallback and Lockout

- Connection-level lockout: exponential cooldown (1h, 2h, 3h...) on 401/403
- Model-level cooldown: per-model `modelLockCount_${model}` tracking
- Account lockout status visible on `/health` page
- Connected-only toggle on `/media-providers/web`
