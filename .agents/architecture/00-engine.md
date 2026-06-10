# Engine Architecture

`open-sse/` is Pod's local inference engine. It is part of the repo and must not be replaced with an npm dependency.

## Main Responsibilities

- Normalize incoming request shapes
- Resolve provider, model, and credentials
- Translate request and response formats
- Apply cache, memory, fallback, and retry behavior
- Stream results safely to clients

## Main Areas

- `config/`: provider metadata, model catalogs, runtime defaults
- `executors/`: upstream request executors
- `handlers/`: orchestration entrypoints such as chat, embeddings, and responses
- `services/`: provider resolution, token refresh, fallback, usage, combos
- `translator/`: request and response shape conversion
- `utils/`: streaming, proxy fetch, header handling, low-level helpers

## Current Invariants

1. Keep streaming crash guards in place.
2. Keep provider-specific retry rules explicit.
3. Preserve combo fallback semantics.
4. Preserve auth refresh and lockout behavior.
5. Prefer safe degradation over hidden failure.

## Read Together With

- `01-app.md`
- `02-providers.md`
- `05-flow.md`
