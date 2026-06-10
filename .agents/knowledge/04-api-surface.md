# API Surface

This file is a compact map, not a full reference.

## Public or Client-Facing APIs

- Health: `/api/health`
- Model listing: `/v1/models`, `/v1/models/[kind]`, `/v1beta/models`
- Core inference routes: chat, responses, embeddings, images, speech, search, fetch

## Dashboard/Internal APIs

- Providers
- Provider nodes
- Models, aliases, custom models, disabled models
- Combos
- Cache
- Memory
- Usage and request logs
- Proxy pools
- Tunnel and relay operations
- Settings and auth

## Rules

1. Mutation routes should parse JSON defensively.
2. Client-facing errors must be sanitized.
3. Protected internal APIs must stay covered by guard + matcher rules.
4. `/api/monitoring/health` is operationally useful and may require API key auth.
