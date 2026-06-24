# Pod — Product Requirements Document

**Version:** v0.0.79 | **Status:** Active development

## Overview

Pod is a self-hosted AI gateway that unifies 50+ LLM providers behind a single OpenAI-compatible endpoint. It handles provider authentication, intelligent routing, fallback chains, semantic caching, usage analytics, and operational visibility through a dark-themed web dashboard.

## Target Users

- Developers wanting one API endpoint for multiple LLM providers
- Teams needing provider redundancy with automatic failover
- Self-hosters wanting full control over AI infrastructure
- Users managing multiple provider accounts with credential rotation

## Core Capabilities

### Provider Unification
- OpenAI-compatible `/v1/chat/completions` plus Anthropic, Gemini, and Ollama endpoints
- 50+ providers: OpenAI, Anthropic, Gemini, Groq, DeepSeek, Mistral, Ollama, and many more
- Auth types: API key, OAuth, cookie/session, local, service account
- Account credential rotation and lockout/cooldown management

### Intelligent Routing
- Model-to-provider mapping with alias resolution
- Combos: model groups with fallback and round-robin strategies
- Provider-level rate limiting (Redis-backed or in-memory) and lockout tracking
- Sticky sessions within combos

### Caching
- Semantic cache with TTL (Redis or in-memory), signatures include memoryOwnerId
- Prompt cache for repeated system prompts
- Cache invalidation via dashboard

### Memory
- Conversational memory pipeline: automatic injection and extraction across sessions
- Memory-aware cache signatures

### Usage Analytics
- Per-provider, per-model token and cost tracking
- Request logs with timestamps, latency, and detail payload
- Provider topology visualization (ReactFlow)

### Proxy & Tunnels
- Cloudflared tunnel support
- SOCKS proxy pools for outbound connections
- Vercel relay for edge-deployed companion services

### Dashboard
- Dark-only, Linear-inspired UI
- Provider health monitoring with real-time SSE updates
- Model diagnostics and testing
- Quota tracking with 3-level expand/collapse
- Cache and memory management
- Settings and auth config
- Combo management with drag-to-reorder

### Offline & PWA
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
- **JavaScript only** — no TypeScript
- **Local open-sse fork** — never replace with npm version
- **SQLite primary store** — optional Redis for rate limiting
- **Dark-only UI** — no light mode
- **Defensive by default** — sanitized errors, safe streaming, crash guards

## Key Numbers

| Metric | Value |
|--------|-------|
| Version | v0.0.79 |
| Default port | 20128 |
| SSE connection cap | 100 concurrent |
| SSE idle timeout | 5 minutes |
| Providers supported | 50+ |
| API endpoints | 10 route families |
| Dashboard pages | 15 (top-level, no /dashboard prefix) |
