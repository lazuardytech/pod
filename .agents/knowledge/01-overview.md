# Overview

Pod is Lazuardy Tech's AI routing proxy — sits between client apps and 50+ LLM providers. Exposes OpenAI/Anthropic/Gemini-compatible endpoints with routing, fallback, caching, rate limiting, and a dashboard.

Current baseline: **v0.0.76**.

## Core Capabilities

- Multi-provider routing with account fallback and format translation
- Streaming + non-streaming via `open-sse` engine
- Semantic response cache (streaming cached too)
- Conversational memory injection/extraction (EN + ID patterns)
   - **CommandCode provider** executor + translator
   - **Qoder provider** with COSY auth (RSA+AES+MD5) and live model catalog
   - **Reasoning passthrough** — reasoning_summary chunks forwarded to delta.reasoning_content
   - **Runtime rate limiting** enforcement on model listing endpoints
   - **Graceful shutdown** — SIGINT flushes queues before exit
   - **Connection lock atomicity** via SQLite transactions
- API key auth with per-key rate limiting (RPM + concurrency)
- Proxy pool support with Vercel relay option
- Tailscale and Cloudflare tunnel integration
- Model cost sync from models.dev (auto on boot, configurable interval)
- OAuth flows for 12+ providers (Code + PKCE, Device Code, Cookie, PAT)
- **SSRF hardening**: `0.0.0.0` and DNS rebinding domains (`nip.io`, `sslip.io`, `localtest.me`, `lvh.me`) blocked in URL validation
- **SSE idle timeout**: 5-minute timeout on all SSE streams — abandoned connections auto-closed
- **Request body size limit**: 10MB max, returns 413 on oversized payloads

## Dashboard Sections

- **API**: Endpoint, Providers, Media Providers, Combos
- **Analytics**: Usage & Analytics, Quota Tracker
- **System**: Proxy Pools, Logs, Health, Settings

## Tech Stack

- Next.js 16 + React 19 + Tailwind CSS v4
- Pure JavaScript (ESM). No TypeScript.
- bun v1.3.14 (package manager + runtime)
- SQLite: `bun:sqlite` (prod), `better-sqlite3` (tests only)
- Linear design system (dark-only "Midnight Command Center")

## Repository Layout

| Dir | Purpose |
|---|---|
| `src/` | Next.js app — dashboard UI, API routes (95+), server libs |
| `open-sse/` | Core routing engine — executors, translators, stream handling |
| `cloud/` | Cloudflare Worker companion deployment |
| `tests/` | ~1300 tests across 66 files |
| `.agents/` | Agent-oriented project knowledge (10 docs, 13 reports) |

## Ground Rules

- `bun` only for all install/build/test workflows
- Validate: `bun run check` → `bun run test:run` → `bun run build`
- Always bump `package.json` AND `src/shared/constants/config.js` `displayVersion` together
- Never use browser `confirm()` — use `ConfirmModal`
- No MITM bypass code
