# Pod — Product Requirements Document

**Version:** v0.0.79
**Status:** Active development

## Overview

Pod is a self-hosted AI gateway that unifies 50+ LLM providers behind a single OpenAI-compatible endpoint. It handles provider authentication, intelligent routing, fallback chains, semantic caching, usage analytics, and operational visibility through a dark-themed web dashboard.

## Target Users

- Developers who want a single API endpoint for multiple LLM providers
- Teams that need provider redundancy with automatic failover
- Self-hosters who want full control over AI infrastructure
- Users managing multiple provider accounts with credential rotation

## Core Capabilities

### Provider Unification
- OpenAI-compatible `/v1/chat/completions` endpoint
- Also exposes Anthropic, Gemini, and native provider formats
- 50+ providers supported (OpenAI, Anthropic, Groq, DeepSeek, Mistral, Gemini, etc.)
- OAuth, API key, cookie/session, and local provider auth types
- Account credential rotation and lockout/cooldown management

### Intelligent Routing
- Model-to-provider mapping with alias resolution
- Combo/fallback chains (primary → fallback on failure)
- Sticky sessions within combos
- Provider-level rate limiting and lockout tracking

### Caching
- Semantic cache (Redis or in-memory) with TTL
- Prompt cache for repeated system prompts
- Cache invalidation through dashboard

### Usage Analytics
- Per-provider, per-model token tracking
- Request logs with timestamps and latency
- Usage-based provider topology visualization

### Proxy & Tunnels
- Cloudflared tunnel support for exposed endpoints
- SOCKS proxy pools for outbound connections
- Vercel relay for edge-deployed companion services

### Dashboard
- Dark-only, Linear-inspired UI
- Provider health monitoring with real-time status
- Model diagnostics and testing
- Cache management and inspection
- Memory/context management
- Settings and authentication config

### Offline & PWA
- Service worker for offline reads
- Offline mutation queue for safe idempotent writes
- Web app manifest for installable PWA

## Non-Goals

- Not a model training or fine-tuning platform
- Not a chat UI (though basic chat completion is possible)
- Not a multi-tenant SaaS (self-hosted single-tenant)
- Not a replacement for provider-native SDKs (it's a proxy)

## Product Constraints

- **Bun-only** — no npm/pnpm for package management
- **JavaScript only** — no TypeScript compilation step
- **Local open-sse fork** — never replace with npm version
- **SQLite primary store** — optional Redis for rate limiting + cache
- **Dark-only UI** — no light mode, compact design
- **Defensive by default** — sanitized errors, safe streaming, crash guards

## Success Criteria

- Single endpoint works for all supported providers
- Automatic failover between providers/models works reliably
- Dashboard provides actionable operational visibility
- Self-hosted deployment is straightforward (Docker Compose)
- Offline mode preserves core read functionality
- Provider credential rotation is seamless

## Recent Changes

### v0.0.79 — Hardening Release
- Sanitized API error responses
- Safe JSON parsing (parseJsonBody)
- Upstream error body leak cleanup
- SSE stream crash containment
- Redis rate limiting support
- Production-safe backend dispatch

### Thinking Block Fix (post-v0.0.79)
- Fixed claude-to-openai translator: <think>/</think> markers no longer leak into content delta
- Thinking text correctly emits as reasoning_content only
