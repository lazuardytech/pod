# Overview

Pod is a self-hosted AI gateway and dashboard that unifies many providers behind OpenAI/Anthropic/Gemini-compatible APIs.

## What Pod Provides

- Multi-provider routing with account fallback and combo chains
- Streaming and non-streaming inference via local `open-sse` engine
- Semantic cache, prompt cache, conversational memory
- Usage analytics, request logs, health monitoring, account lockout tracking
- OAuth/API key/cookie-based provider integrations (15+ providers)
- Tunnel support (Cloudflare and Tailscale)
- PWA installability and offline-first dashboard behavior
- Redis-backed rate limiting with in-memory fallback

## Current Focus (v0.0.79)

- Security hardening: error sanitization, JSON body parsing, SSE crash guards
- Redis rate limiting with duck-type backend dispatch
- Connection-level lockout with exponential cooldown
- Zeabur Docker deployment
- Multi-instance architecture planning (LiteFS + Redis)

## Technical Stack

- Next.js 16 + React 19
- JavaScript (ESM), no TypeScript
- bun runtime and package manager
- SQLite storage via `bun:sqlite`
- Cloudflare Worker for cloud proxy
- Tailwind v4 with Linear-inspired "Midnight Command Center" design system

## Important Baseline Facts

- Runtime command: `bun /app/server.js`
- Data file: `~/.pod/pod.sqlite`
- Docker image: `lazuardytech/pod`
- Docker compose: pod + redis + searxng
- Tests: 1305 across 67 files
- open-sse: local only, never from npm (resolved via `jsconfig.json`)
