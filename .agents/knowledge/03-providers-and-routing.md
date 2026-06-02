# Providers and Routing

## Provider Sources

- Transport config: `open-sse/config/providers.js`
- Model mapping: `open-sse/config/providerModels.js`
- Error and retry behavior: `open-sse/config/errorConfig.js`
- Dashboard metadata: `src/shared/constants/providers.js`

## Routing Model

1. Resolve requested model and alias
2. Expand combo strategy when applicable
3. Pick eligible credential/account
4. Execute provider call
5. On retryable failure: lock account/model and try next candidate

## Key Behaviors

- Multi-account fallback is first-class
- Streaming and non-streaming both supported
- Per-provider protocol quirks are handled in executors/translators

## Important Invariants

- Built-in providers cannot be renamed
- Vertex payload must not include `stream`
- Codex overload peek must stay single-reader
- Kiro transient retry is body-gated
