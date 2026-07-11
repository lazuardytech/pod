# Pod — Product Requirements Document

**Version:** v0.0.82 | **Status:** Active development

## Overview

Pod is a self-hosted AI gateway that unifies 50+ LLM providers behind a single OpenAI-compatible endpoint. It handles provider authentication, intelligent routing, fallback chains, semantic caching, usage analytics, and operational visibility through a dark-themed web dashboard.

## Target Users

- Developers wanting one API endpoint for multiple LLM providers
- Teams needing provider redundancy with automatic failover
- Self-hosters wanting full control over AI infrastructure
- Users managing multiple provider accounts with credential rotation

## Core Capabilities

### Provider Unification

- OpenAI-compatible `/v1/*` endpoints: chat/completions, responses, embeddings, audio (speech, transcriptions, translations), images (generations, edits, variations), moderations, models (list, detail), files (upload, retrieve, delete)
- Anthropic `/v1/messages` and `/v1/messages/count_tokens` compatibility
- Ollama `/v1/api/chat` endpoint
- 50+ providers across free, API-key, OAuth, and self-hosted categories
- Auth types: API key, OAuth, cookie/session, local, service account
- Account credential rotation and lockout/cooldown management

### Intelligent Routing

- Model-to-provider mapping with alias resolution
- Combos: model groups with fallback and round-robin strategies
- Provider-level rate limiting (Redis-backed or in-memory) and lockout tracking
- Sticky sessions within combos

### Caching

- Semantic cache with TTL (in-memory), signatures include memoryOwnerId
- Prompt cache for repeated system prompts
- Cache invalidation via dashboard

### Memory

- Conversational memory pipeline: automatic injection and extraction across sessions
- Memory-aware cache signatures

### Usage Analytics

- Per-provider, per-model token and cost tracking
- Request logs with timestamps, latency, and detail payload
- Provider topology visualization (ReactFlow)

### Proxy and Tunnels

- Cloudflared tunnel support
- SOCKS proxy pools for outbound connections
- Vercel relay for edge-deployed companion services

### Dashboard

- Dark-only, Linear-inspired UI (15 top-level pages, no `/dashboard` prefix)
- Provider health monitoring with real-time SSE updates
- Model diagnostics and testing
- Quota tracking with 3-level expand/collapse
- Cache and memory management
- Settings and auth config
- Combo management with drag-to-reorder

### Offline and PWA

- Service worker for offline reads (offlineJsonCache)
- Offline mutation queue for safe idempotent writes
- Installable PWA with web app manifest

## Non-Goals

- Not a model training or fine-tuning platform
- Not a chat UI (though chat completion is proxiable)
- Not a multi-tenant SaaS (self-hosted single-tenant)
- Not a replacement for provider-native SDKs

## Product Constraints

- **Bun-only** — never npm/pnpm
- **Local open-sse fork** — never replace with npm version, frozen as JS
- **SQLite primary store** — optional Redis for rate limiting
- **Dark-only UI** — no light mode
- **Defensive by default** — sanitized errors, safe streaming, crash guards

## Operational Guarantees

- **Abort-safe streaming**: Client disconnects return 499 (not 500); no unhandledRejection floods. SSE stream wrappers use `controller.close()` on abort. Global `unhandledRejection` handler classifies `node:_http_server` aborts as `[ClientDisconnect]` and dedupes within 1s.
- **Chunked body reading**: Large request bodies (5MB+) are stream-read in chunks to prevent 9-15s stalls. `readBodyTextStream()` enforces the size cap mid-stream and returns 413 on overflow.
- **Configurable body cap**: All mutation routes enforce a 50MB default body cap (env-tunable). 413 returned on overflow; no silent memory spikes.
- **Compatibility first**: OpenAI/Anthropic error shapes, auth headers, streaming format, and tool calling match official specs. Any regression is a release blocker.
- **Offline-first dashboard**: Reads degrade via `offlineJsonCache`; writes queue via mutation stack; only safe idempotent mutations queued.

## Key Numbers

| Metric              | Value                                                                                         |
| ------------------- | --------------------------------------------------------------------------------------------- |
| Version             | v0.0.82                                                                                       |
| Default port        | 20128                                                                                         |
| SSE connection cap  | 100 concurrent                                                                                |
| SSE idle timeout    | 5 minutes                                                                                     |
| Body cap            | 50MB default (env: POD_MAX_REQUEST_BODY_BYTES, POD_MAX_CHAT_BODY_BYTES)                       |
| Providers supported | 50+                                                                                           |
| API route families  | 10 (chat, responses, messages, embeddings, audio, images, moderations, models, files, ollama) |
| Dashboard pages     | 15 (top-level, no /dashboard prefix)                                                          |
