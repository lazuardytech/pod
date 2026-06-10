# Pod PRD

Version: `v0.0.79`

## Product Summary

Pod is a self-hosted AI gateway and operations dashboard. It unifies many upstream providers behind OpenAI-compatible and adjacent APIs, manages credentials, translates request/response formats, and exposes operational controls through a compact dark dashboard.

## Goals

1. Provide one stable endpoint for many AI providers.
2. Hide provider auth and token-refresh complexity from clients.
3. Keep routing, fallback, and lockout behavior reliable.
4. Offer operational visibility for usage, health, cache, memory, and tunnels.
5. Remain self-hostable with local-first defaults.

## Target Users

- Solo developers using multiple coding assistants
- Small teams sharing providers and limits
- Self-hosters running Pod on Docker, VPS, NAS, or Zeabur-like environments

## Core Capabilities

- OpenAI-compatible chat and related AI APIs
- Provider connections across OAuth, API key, cookie, and local modes
- Fallback routing, combos, retries, and lockouts
- Semantic cache and conversational memory
- Usage analytics, request logs, health monitoring
- Proxy pools, cloud relay options, tunnels, and PWA/offline support

## Non-Goals

- Pod is not a model training platform
- Pod is not a full identity platform
- Pod is not a generic workflow engine
- Pod does not depend on a managed cloud database by default

## Product Constraints

- Bun-only workflow
- Local `open-sse` engine
- SQLite as the primary local data source
- Dark-only dashboard design
- Strong preference for defensive, production-safe behavior

## Success Criteria

- New provider or route changes do not break existing clients
- Auth refresh and fallback are predictable
- API errors stay sanitized
- Build, runtime, and deployment behavior remain observable
- Docs stay aligned with the live repo, not only with historical audits
