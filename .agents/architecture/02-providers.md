# Provider Architecture

Pod supports a wide provider matrix through configuration, credential storage, refresh flows, and executor dispatch.

## Provider Layers

1. `open-sse/config/providers.js` defines provider metadata and auth shape.
2. `src/sse/services/auth.js` resolves usable connections.
3. `open-sse/services/tokenRefresh.js` handles refresh for OAuth-like providers.
4. Executors call upstream APIs.
5. Translators normalize provider differences for clients.

## Auth Shapes

- OAuth
- API key
- Cookie/session
- No-auth local service
- Service-account style flows

## Current Rules

1. Preserve connection lockout and cooldown behavior.
2. Preserve provider-specific retry logic where upstreams are special.
3. Keep model listing and routing rules aligned.
4. Keep compatible-node behavior separate from built-in providers.
5. Treat provider drift as expected; verify against live behavior when changing integrations.
