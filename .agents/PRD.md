# Pod — Product Requirements Document

Version: v0.0.79 | Status: Live

## Executive Summary

Pod is a self-hosted AI gateway that unifies 50+ AI providers behind a single OpenAI-compatible API endpoint. It handles credential management, format translation, rate limiting, semantic caching, and routing — all through a dark-themed operational dashboard inspired by Linear's design system.

## Goals

1. **Single endpoint for all AI providers.** Any OpenAI-compatible client works with Pod immediately — no per-provider SDK changes.
2. **Credential abstraction.** OAuth refresh, API key rotation, cookie-based auth — all managed transparently. Users never handle tokens directly.
3. **Production reliability.** Rate limiting, connection lockout, graceful shutdown, SSE stream crash containment.
4. **Operational visibility.** Usage analytics, request logs, health monitoring, account lockout tracking — all in one dashboard.
5. **Self-hosted privacy.** Everything runs locally. SQLite for data, no cloud dependency except optional Cloudflare Worker proxy.

## User Personas

### Solo Developer
- Runs Pod locally on a MacBook
- Connects personal API keys and OAuth accounts
- Uses Pod as the single endpoint for all coding assistants (Claude Code, Cursor, Cline, Codex)
- Needs: Quick setup, reliable routing, no manual token management

### Small Team Lead
- Runs Pod on a VPS or home server
- Manages shared API keys with usage limits
- Uses tunnels (Cloudflare/Tailscale) for remote access
- Needs: Usage analytics, rate limiting, multi-provider fallback

### Self-Hoster / Hobbyist
- Runs Pod via Docker Compose on a NAS or mini PC
- Uses free-tier providers and local models (Ollama)
- Needs: Docker simplicity, PWA offline support, minimal maintenance

## Feature Inventory

### Core Proxy
| Feature | Status | Description |
|---------|--------|-------------|
| OpenAI-compatible `/v1/chat/completions` | ✅ Live | Main inference endpoint |
| Anthropic-compatible `/v1/messages` | ✅ Live | Claude API format |
| Gemini-compatible `/v1beta/models` | ✅ Live | Gemini API format |
| OpenAI Responses API | ✅ Live | `/v1/responses` + compact variant |
| Embeddings | ✅ Live | 15+ embedding providers |
| Image generation | ✅ Live | 15+ image providers |
| TTS / STT | ✅ Live | Speech synthesis + transcription |
| Web search | ✅ Live | Multi-provider search proxy |
| Web fetch | ✅ Live | URL content extraction proxy |

### Provider Support
| Feature | Status | Description |
|---------|--------|-------------|
| OAuth providers | ✅ Live | Claude, Codex, Gemini CLI, GitHub, Qwen, iFlow, Kiro, Cursor, Antigravity |
| API key providers | ✅ Live | OpenAI, DeepSeek, Groq, xAI, Mistral, Together, Cerebras, Cohere, 20+ more |
| Cookie-based providers | ✅ Live | Grok Web, Perplexity Web |
| Local providers | ✅ Live | Ollama |
| Compatible nodes | ✅ Live | OpenAI-compatible, Anthropic-compatible, custom embedding |
| Provider nodes | ✅ Live | Custom endpoints with rename, test, clear-lock |

### Routing & Reliability
| Feature | Status | Description |
|---------|--------|-------------|
| Multi-account fallback | ✅ Live | Try next credential on failure |
| Model combos | ✅ Live | Ordered fallback chain across providers |
| Connection-level lockout | ✅ Live | Exponential cooldown (1h, 2h, 3h...) on auth failures |
| Model-level cooldown | ✅ Live | Per-model rate limit cooldown |
| Retry strategies | ✅ Live | Configurable: 429/502/503/504, per-provider overrides |
| Vercel relay | ✅ Live | Relay timeout, single retry on 502/504 |

### Caching & Memory
| Feature | Status | Description |
|---------|--------|-------------|
| Semantic cache | ✅ Live | Similarity-based response caching |
| Prompt cache | ✅ Live | Claude-style cache_control |
| Conversational memory | ✅ Live | FTS5 search, auto-extraction, token budget |
| Cache TTL | ✅ Live | ISO-8601 strftime comparisons in SQLite |
| Offline JSON cache | ✅ Live | IndexedDB-backed stale-while-revalidate cache for dashboard reads |
| Offline cache invalidation | ✅ Live | Tag-based invalidation after safe mutations with conditional revalidation (ETag / Last-Modified) |

### Rate Limiting
| Feature | Status | Description |
|---------|--------|-------------|
| Per-API-key RPM | ✅ Live | Sliding window via Redis or in-memory |
| Per-API-key concurrent | ✅ Live | Atomic INCR/DECR |
| Redis backend | ✅ Live | Bun.RedisClient, zero npm dependency |
| In-memory fallback | ✅ Live | Auto-fallback when Redis unavailable |
| Streaming release | ✅ Live | Release on stream cancel/disconnect |

### Dashboard UI
| Feature | Status | Description |
|---------|--------|-------------|
| Endpoint management | ✅ Live | Base URL, API key display, quick start |
| Provider management | ✅ Live | Connections, models, cooldown status, custom models |
| Combo builder | ✅ Live | Model fallback chain editor |
| Usage analytics | ✅ Live | Charts, tables, topology map, quota tracking |
| Health monitoring | ✅ Live | System telemetry, account lockout status |
| Request logs | ✅ Live | Live SSE stream, detail view, console output |
| Cache browser | ✅ Live | View and clear semantic cache |
| Memory browser | ✅ Live | Search, view, edit, delete memories |
| Settings | ✅ Live | Thinking, memory, cache, strategies |
| Translator | ✅ Live | Format translator with test console |
| Basic chat | ✅ Live | Built-in playground |
| Proxy pools | ✅ Live | HTTP/SOCKS proxy management, Vercel deploy |
| Media providers | ✅ Live | Web/media/search/fetch provider config |

### Infrastructure
| Feature | Status | Description |
|---------|--------|-------------|
| Docker deployment | ✅ Live | Multi-stage Alpine, docker-compose with redis + searxng |
| Cloudflare tunnel | ✅ Live | Named tunnels + quick tunnels |
| Tailscale | ✅ Live | Funnel + daemon management |
| PWA support | ✅ Live | Install prompt, manifest, versioned service worker, offline fallback |
| Offline read cache | ✅ Live | stale-while-revalidate with IndexedDB persistence and conditional revalidation |
| Offline write queue | ✅ Live | Safe idempotent mutation queue with sync status indicator and post-replay cache invalidation |
| Static asset cache strategy | ✅ Live | Hashed assets use stale-while-revalidate; non-hashed assets use network-first fallback |
| Cloudflare Worker | ✅ Live | Cloud proxy with D1 + KV |

### Security
| Feature | Status | Description |
|---------|--------|-------------|
| Error sanitization | ✅ Live | Production-safe messages (60+ routes) |
| Safe JSON parsing | ✅ Live | Malformed JSON → 400 (45+ routes) |
| Upstream error masking | ✅ Live | Generic status-only messages |
| SSRF protection | ✅ Live | Block 0.0.0.0 + DNS rebinding |
| SHUTDOWN_SECRET | ✅ Live | Protected restart/shutdown |
| Dashboard auth | ✅ Live | Password login + JWT + CLI token |
| API key auth | ✅ Live | Per-key rate limits + model-list enforcement |

## Non-Functional Requirements

### Performance
- SSE connection cap: 100 per route
- SSE idle timeout: 5 minutes
- Upstream timeout: 45 seconds (configurable)
- Vercel relay timeout: pod timeout − 5s

### Reliability
- Graceful shutdown with queue flush
- Global unhandledRejection and uncaughtException handlers
- SIGTERM forwarded to all child processes (cloudflared, tailscaled)
- Stream crash containment at 3 points (chat loop, transform, peek reader)
- Service worker cache rollover is release-versioned to avoid stale shell/static bundles
- Offline dashboard data revalidates via ETag / Last-Modified when available

### Maintainability
- JavaScript ESM, no TypeScript
- bun-only toolchain
- SQLite single-file database
- 1305 tests across 67 files
- Biome formatting (no Prettier/ESLint)
- RWX CI pipeline (check → test → build)

## Roadmap (Planned)

### v0.1.0 — Multi-Instance
- LiteFS distributed SQLite
- Redis mandatory for rate limiting
- Load-balanced deployment (2-3 replicas)
- Zeabur Docker with persistent volumes

### Future Considerations
- Admin multi-user with roles
- Webhook notifications for lockout/rate-limit events
- Custom provider plugin system
- Metrics export (Prometheus/OTel)
