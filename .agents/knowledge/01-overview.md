# Overview

Pod is a self-hosted AI gateway and dashboard that unifies many providers behind OpenAI/Anthropic/Gemini-compatible APIs.

## What Pod Provides

- Multi-provider routing with account fallback
- Streaming and non-streaming inference via local `open-sse`
- Semantic cache and prompt cache
- Usage analytics, request logs, health monitoring
- OAuth/API key/cookie-based provider integrations
- Tunnel support (Cloudflare and Tailscale)
- PWA installability and offline-first dashboard behavior

## Current Focus (v0.0.78)

- Stability and routing correctness
- Security and operational hardening
- Provider behavior normalization
- Offline-first UX for read and safe write operations

## Technical Stack

- Next.js 16 + React 19
- JavaScript (ESM), no TypeScript
- bun runtime and package manager
- SQLite storage

## Important Baseline Facts

- Runtime command: `bun /app/server.js`
- Data file: `~/.pod/pod.sqlite`
- Docker image: `lazuardytech/pod`
