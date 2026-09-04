# Pod

> **Self-hosted AI gateway and proxy** — unify 84 LLM providers behind a single OpenAI-compatible endpoint.

v0.0.86 — active development on `canary`, stable releases on `main`.

Three layers: **App** (`src/` Next.js dashboard + API) → **Engine** (`open-sse/` routing, translation, streaming) → **Data & ops** (`src/lib/` SQLite, cache, rate limit, tunnels). Public `/v1/*` rewrites to `/api/v1/*`. Server startup: `src/instrumentation.ts` → `initializeApp()`.

---

## Features

- **Multi-provider routing** — OpenAI, Anthropic, Gemini, Codex, Ollama, 84 built-in providers plus custom nodes
- **Compatibility APIs** — OpenAI `/v1/*` (chat, responses, embeddings, audio, images/generations, models; files/edits/variations are 501 stubs), Anthropic `/v1/messages`, Ollama `/v1/api/chat`
- **Semantic cache** — deduplicates identical requests (streaming too); TTL-based eviction
- **Prompt cache** — repeated system prompt reuse with separate TTL
- **Conversational memory** — automatic injection and extraction across sessions
- **API key auth** — per-key rate limiting (req/min + concurrent cap)
- **Rate limiting** — Redis-backed limiter (`REDIS_URL`) with in-memory fallback; isolate keys with `RATELIMIT_KEY_PREFIX` (`local:` / `pod:` / `pod-canary:`)
- **Dashboard auth** — `requireLogin` defaults true; internal `/api/*` mutations use JWT cookie or `x-9r-cli-token` (`checkDashboardApiAuth`). Health routes stay public.
- **Combos** — model groups with fallback, round-robin, or Fusion (parallel panel + judge); Vision Adapter pools for image/audio turns
- **Token Saver** — RTK tool-output compression, Headroom `/v1/compress` (fail-open; local Python spawn or compose overlay), Caveman + Ponytail system prompts (`X-Pod-Token-Saver: off` to skip)
- **Thinking copy suffix** — Provider Detail copies `alias/model(level)` from the existing Thinking Effort dropdown (`gpt-5(high)`). OmniRoute Vision Bridge is not in 9router and is not ported.
- **Proxy pools** — per-provider proxy config with optional Vercel relay
- **Tunnel support** — Tailscale and Cloudflare tunnel integration
- **Dashboard** — full web UI for providers, usage analytics, quota tracking, logs, and health (dark-only, Linear-inspired)
- **Account lockout** — exponential cooldown on auth failures, visible on health
- **PWA & offline** — installable dashboard; network-first SW navigation with offline fallback; offlineJsonCache reads + mutation queue

## Quick Start

### Docker (standalone)

```bash
docker run -d --name pod -p 20128:20128 -v pod-data:/app/data lazuardytech/pod:latest
```

Open `http://localhost:20128`.

### Docker Compose (with Redis + SearXNG)

```bash
cd docker && docker compose up -d
# Redis published on localhost:6379 — set REDIS_URL=redis://127.0.0.1:6379 and RATELIMIT_KEY_PREFIX=local:
```

With an env file:

```bash
docker run -d --name pod -p 20128:20128 -v pod-data:/app/data --env-file .env lazuardytech/pod:latest
```

### Token Saver (Headroom)

Pod calls `POST {HEADROOM_URL}/v1/compress` and **fails open** if the sidecar is down. Allowed compress hosts: `localhost`, `127.0.0.1`, `::1`, `headroom`.

**Local spawn** (Python `headroom` CLI on PATH): Endpoint Token Saver can start/stop/restart a loopback proxy (`POST /api/headroom/start|stop|restart`). Spawn refuses non-loopback URLs. Docker image has no Python — use the compose overlay instead. Zeabur: set `HEADROOM_URL` only; do not add a Headroom service.

Local CLI:

```bash
headroom proxy --port 8787
# HEADROOM_URL=http://localhost:8787  (default)
```

Docker Compose overlay (hostname `headroom`):

```bash
cd docker && docker compose -f docker-compose.yml -f docker-compose.headroom.yml up -d
```

Zeabur: set `HEADROOM_URL` only — do not add a Headroom service.

### Local Development

Requires [bun](https://bun.sh) v1.4.0+.

> Production deploy on Zeabur uses **port 20140** (overridden via `PORT` env). Local dev and Docker default to **port 20128**.

```bash
bun install
bun run dev # starts on http://localhost:20128
```

## Operational Notes

- **Body size cap**: Default 50MB per request. Override with `POD_MAX_REQUEST_BODY_BYTES` (and `POD_MAX_CHAT_BODY_BYTES` for chat routes). Requests exceeding the cap return `413 Payload Too Large`.
- **Client disconnect handling**: Pod returns `499 Client Closed Request` on abrupt client disconnects (browser tab close, network drop, cancelled stream). `AbortError` at `node:_http_server` is classified as `[ClientDisconnect]` (not `[FATAL]`) and SSE wrappers call `controller.close()` on abort — no unhandled rejections, no log spam.
- **Large-body latency**: Node's HTTP body parser can cause 9–15s stalls for bodies > 1MB (notably `curl/8.x`). Chat and sibling routes read via `readBodyTextStream()` (chunk-by-chunk with a size cap) to avoid the stall.
- **Health checks**: `GET /api/health`, `GET /api/monitoring/health`, and `GET /api/monitoring/health/stream` are all public reads (no auth).
- **Service worker**: Navigation is network-first (not cache-first). Never surface `Response.error()` for documents/images; registrar must not blind-reload on `controllerchange`. See `.agents/knowledge/04-gotchas.md` §34.

## Environment Variables

| Variable                          | Default                                 | Description                                                                              |
| --------------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------- |
| `PORT`                            | `20128`                                 | HTTP port                                                                                |
| `DATA_DIR`                        | `~/.pod` locally, `/app/data` in Docker | SQLite data directory                                                                    |
| `INITIAL_PASSWORD`                | `123456`                                | Initial dashboard login password. Change after first login.                              |
| `JWT_SECRET`                      | _(required)_                            | Secret for dashboard auth sessions                                                       |
| `API_KEY_SECRET`                  | _(required)_                            | HMAC secret for generated Pod API keys                                                   |
| `SHUTDOWN_SECRET`                 | _(none)_                                | Shared secret for `/api/restart` and `/api/shutdown`                                     |
| `MACHINE_ID_SALT`                 | `endpoint-proxy-salt`                   | Salt for machine-bound identifiers                                                       |
| `ENABLE_REQUEST_LOGS`             | `false`                                 | Enable request log capture at runtime                                                    |
| `OBSERVABILITY_ENABLED`           | `true`                                  | Enable request-details observability storage                                             |
| `OBSERVABILITY_MAX_RECORDS`       | `200`                                   | Max request-detail rows retained                                                         |
| `OBSERVABILITY_BATCH_SIZE`        | `20`                                    | Buffered write batch size for request details                                            |
| `OBSERVABILITY_FLUSH_INTERVAL_MS` | `5000`                                  | Max delay before flushing buffered request details                                       |
| `OBSERVABILITY_MAX_JSON_SIZE`     | `5`                                     | Max stored JSON payload size in KiB per request-detail blob                              |
| `AUTH_COOKIE_SECURE`              | `false`                                 | Force secure auth cookies                                                                |
| `REQUIRE_API_KEY`                 | `false`                                 | Require API keys on protected `/v1/*` endpoints                                          |
| `BASE_URL`                        | `http://localhost:20128`                | Internal base URL for self-referencing API calls                                         |
| `CLOUD_URL`                       | _(none)_                                | URL of self-hosted Cloudflare Worker (cloud deployment)                                  |
| `NEXT_TELEMETRY_DISABLED`         | `1`                                     | Disable Next.js telemetry                                                                |
| `SEMANTIC_CACHE_MAX_BYTES`        | `4194304`                               | Semantic cache max size in bytes                                                         |
| `SEMANTIC_CACHE_MAX_SIZE`         | `100`                                   | Semantic cache max entries                                                               |
| `SEMANTIC_CACHE_TTL_MS`           | `1800000`                               | Semantic cache TTL (ms)                                                                  |
| `PROMPT_CACHE_MAX_BYTES`          | `2097152`                               | Prompt cache max size in bytes                                                           |
| `PROMPT_CACHE_MAX_SIZE`           | `50`                                    | Prompt cache max entries                                                                 |
| `PROMPT_CACHE_TTL_MS`             | `300000`                                | Prompt cache TTL (ms)                                                                    |
| `REDIS_URL`                       | _(none)_                                | Redis URL for **rate limits only** (in-memory if unset). Local: `redis://127.0.0.1:6379` |
| `RATELIMIT_KEY_PREFIX`            | _(empty in code)_                       | Redis key namespace. Set `local:` locally; Zeabur `pod:` / `pod-canary:`                 |
| `RATELIMIT_REDIS_TIMEOUT_MS`      | `1000`                                  | Per-operation timeout (ms) wrapper for Redis rate-limit calls                            |
| `POD_MAX_REQUEST_BODY_BYTES`      | `52428800` (50MB)                       | Max request body bytes for non-chat routes                                               |
| `POD_MAX_CHAT_BODY_BYTES`         | inherits `POD_MAX_REQUEST_BODY_BYTES`   | Max request body bytes for chat/completions routes                                       |
| `HEADROOM_URL`                    | `http://localhost:8787`                 | Default Headroom compress origin (Token Saver). Loopback / `headroom` only               |
| `ENABLE_TRANSLATOR`               | `false`                                 | Enable the translator debug console when set to `true`                                   |
| `LOG_LEVEL`                       | _(unset)_                               | `debug` / `info` / `warn` / `error` — SSE logger verbosity                               |
| `IFLOW_OAUTH_CLIENT_SECRET`       | _(optional)_                            | Required for iFlow OAuth flows or token refresh                                          |
| `QODER_OAUTH_CLIENT_ID`           | _(optional)_                            | Optional Qoder OAuth client ID override                                                  |
| `QODER_OAUTH_CLIENT_SECRET`       | _(optional)_                            | Required for Qoder OAuth flows                                                           |

## API Endpoints

All endpoints accept `Authorization: Bearer <key>` or `x-api-key: <key>` when API key auth (`REQUIRE_API_KEY`) is enabled.

| Endpoint                         | Protocol                                    |
| -------------------------------- | ------------------------------------------- |
| `POST /v1/chat/completions`      | OpenAI Chat                                 |
| `POST /v1/messages`              | Anthropic Messages                          |
| `POST /v1/responses`             | OpenAI Responses                            |
| `POST /v1/embeddings`            | OpenAI Embeddings                           |
| `POST /v1/audio/speech`          | OpenAI TTS                                  |
| `POST /v1/audio/transcriptions`  | OpenAI STT                                  |
| `POST /v1/audio/translations`    | OpenAI Translations                         |
| `POST /v1/images/generations`    | OpenAI Image Gen                            |
| `POST /v1/images/edits`          | OpenAI Image Edit — **501**                 |
| `POST /v1/images/variations`     | OpenAI Image Variation — **501**            |
| `POST /v1/moderations`           | OpenAI Moderations (mock: always unflagged) |
| `POST /v1/messages/count_tokens` | Anthropic Token Count (char-based estimate) |
| `GET /v1/models`                 | OpenAI Model List                           |
| `GET /v1/models/{model}`         | OpenAI Model Detail                         |
| `GET /v1/files`                  | OpenAI File List (empty)                    |
| `POST /v1/files`                 | OpenAI File Upload — **501**                |
| `GET /v1/files/{file_id}`        | OpenAI File Retrieve (404)                  |
| `DELETE /v1/files/{file_id}`     | OpenAI File Delete (404, no file store)     |
| `GET /v1beta/models`             | Gemini Model List                           |
| `POST /v1/api/chat`              | Ollama Chat                                 |
| `POST /v1/search`                | Web Search                                  |
| `POST /v1/web/fetch`             | URL Fetch                                   |

Compatibility details: [`.agents/compatibility-matrix.md`](.agents/compatibility-matrix.md).

## Supported Providers

Provider definitions live in `src/shared/constants/providers.ts` (`AI_PROVIDERS`: **84** built-in). Categories include:

- **Free access**: Kiro AI, Qwen Code, Gemini CLI, iFlow AI, OpenCode Free
- **Free tier / API-key**: OpenRouter, NVIDIA NIM, Ollama Cloud, Vertex AI, Gemini, Cloudflare, BytePlus ModelArk
- **OAuth / tool-account**: Claude Code, Antigravity, OpenAI Codex, GitHub Copilot, Cursor IDE, Kilo Code, Cline
- **API key / self-hosted**: GLM Coding, GLM (China), Kimi, Minimax Coding, Minimax (China), Alibaba, Alibaba Intl, Xiaomi MiMo, Volcengine Ark, OpenAI, Anthropic, OpenCode Go, Azure OpenAI, DeepSeek, Groq, xAI (Grok), Mistral, Together AI, Fireworks AI, Cerebras, Cohere, Nebius AI, SiliconFlow, Hyperbolic, Blackbox AI, Chutes AI, Ollama Local, Vertex Partner
- **Speech, embeddings, image, search**: Deepgram, AssemblyAI, ElevenLabs, Cartesia, PlayHT, Google TTS, Edge TTS, Coqui TTS, Tortoise TTS, Inworld TTS, Voyage AI, SD WebUI, ComfyUI, HuggingFace, Tavily, Brave Search, Serper, Exa, SearXNG, Google PSE, Linkup, SearchAPI, You.com Search, Firecrawl, Fal.ai, Stability AI, Black Forest Labs, Recraft, Topaz, Runway ML, AWS Polly, Jina AI, Jina Reader
- **Custom nodes**: OpenAI-compatible, Anthropic-compatible, and custom embedding nodes can be added via the dashboard

## Development

```bash
bun install          # install dependencies
bun run dev          # start dev server on :20128 (turbopack)
bun run build        # production build (turbopack)
bun run format       # oxfmt format
bun run lint         # oxlint --deny-warnings
bun run check        # oxfmt + oxlint --deny-warnings + tsc (--noEmit)
bun run test:run     # vitest run (verbose)
bun run test:coverage # vitest with coverage
```

Always run `bun run check && bun run test:run && bun run build` before pushing.

See [AGENTS.md](AGENTS.md) for project rules, [DESIGN.md](DESIGN.md) for UI tokens, [CONTRIBUTING.md](CONTRIBUTING.md) for PRs. Additional agent context in [`.agents/INDEX.md`](.agents/INDEX.md).

## Repository Map

| Path        | Purpose                                          |
| ----------- | ------------------------------------------------ |
| `src/`      | App layer (pages, API routes, lib, shared, SSE)  |
| `open-sse/` | Local engine fork (routing, translation, stream) |
| `cloud/`    | Cloudflare Worker proxy backend                  |
| `tests/`    | Vitest test suite (unit + smoke)                 |
| `docker/`   | Dockerfile and docker-compose.yml                |
| `scripts/`  | Build, SW, Cloud Agent helpers                   |
| `public/`   | PWA assets, `sw.js`                              |
| `.agents/`  | Architecture, knowledge, issues, reports, plans  |

## License

[MIT](https://github.com/lazuardytech/pod/blob/main/LICENSE) — Copyright (c) 2024-2026 Lazuardy Technology and contributors.
