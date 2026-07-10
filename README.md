# Pod

> **Self-hosted AI gateway and proxy** — unify 50+ LLM providers behind a single OpenAI-compatible endpoint.

v0.0.82 — active development on `canary`, stable releases on `main`.

---

## Features

- **Multi-provider routing** — OpenAI, Anthropic, Gemini, Codex, Ollama, 50+ providers
- **Compatibility APIs** — OpenAI `/v1/*` endpoints (chat, responses, embeddings, audio, images, moderations, models, files), Anthropic `/v1/messages`, Ollama `/v1/api/chat`
- **Semantic cache** — deduplicates identical requests (streaming too); TTL-based eviction
- **Prompt cache** — repeated system prompt reuse with separate TTL
- **Conversational memory** — automatic injection and extraction across sessions
- **API key auth** — per-key rate limiting (req/min + concurrent cap)
- **Rate limiting** — Redis-backed distributed limiter with in-memory fallback
- **Combos** — model groups with fallback and round-robin strategies
- **Proxy pools** — per-provider proxy config with optional Vercel relay
- **Tunnel support** — Tailscale and Cloudflare tunnel integration
- **Dashboard** — full web UI for providers, usage analytics, quota tracking, logs, and health (dark-only, Linear-inspired)
- **Account lockout** — exponential cooldown on auth failures, visible on health
- **PWA & offline-first** — installable dashboard with service worker caching, offline reads, mutation queue

## Quick Start

### Docker (standalone)

```bash
docker run -d --name pod -p 20128:20128 -v pod-data:/app/data lazuardytech/pod:latest
```

Open `http://localhost:20128`.

### Docker Compose (with Redis + SearXNG)

```bash
cd docker && docker compose up -d
```

With an env file:

```bash
docker run -d --name pod -p 20128:20128 -v pod-data:/app/data --env-file .env lazuardytech/pod:latest
```

### Local Development

Requires [bun](https://bun.sh) v1.3.14+.

> Production deploy on Zeabur uses **port 20140** (overridden via `PORT` env). Local dev and Docker default to **port 20128**.

```bash
bun install
bun run dev        # starts on http://localhost:20128
```

## Operational Notes

- **Body size cap**: Default 50MB per request. Override with `POD_MAX_REQUEST_BODY_BYTES` (and `POD_MAX_CHAT_BODY_BYTES` for chat routes). Requests exceeding the cap return `413 Payload Too Large`.
- **Client disconnect handling**: Pod returns `499 Client Closed Request` on abrupt client disconnects (browser tab close, network drop, cancelled stream). No unhandled rejections, no log spam.
- **Health checks**: `GET /api/health` is public. `GET /api/monitoring/health` requires an API key.

## Environment Variables

| Variable                          | Default                                 | Description                                                       |
| --------------------------------- | --------------------------------------- | ----------------------------------------------------------------- |
| `PORT`                            | `20128`                                 | HTTP port                                                         |
| `DATA_DIR`                        | `~/.pod` locally, `/app/data` in Docker | SQLite data directory                                             |
| `INITIAL_PASSWORD`                | `123456`                                | Initial dashboard login password. Change after first login.       |
| `JWT_SECRET`                      | _(required)_                            | Secret for dashboard auth sessions                                |
| `API_KEY_SECRET`                  | _(required)_                            | HMAC secret for generated Pod API keys                            |
| `SHUTDOWN_SECRET`                 | _(none)_                                | Shared secret for `/api/restart` and `/api/shutdown`              |
| `MACHINE_ID_SALT`                 | `endpoint-proxy-salt`                   | Salt for machine-bound identifiers                                |
| `ENABLE_REQUEST_LOGS`             | `false`                                 | Enable request log capture at runtime                             |
| `OBSERVABILITY_ENABLED`           | `true`                                  | Enable request-details observability storage                      |
| `OBSERVABILITY_MAX_RECORDS`       | `200`                                   | Max request-detail rows retained                                  |
| `OBSERVABILITY_BATCH_SIZE`        | `20`                                    | Buffered write batch size for request details                     |
| `OBSERVABILITY_FLUSH_INTERVAL_MS` | `5000`                                  | Max delay before flushing buffered request details                |
| `OBSERVABILITY_MAX_JSON_SIZE`     | `5`                                     | Max stored JSON payload size in KiB per request-detail blob       |
| `AUTH_COOKIE_SECURE`              | `false`                                 | Force secure auth cookies                                         |
| `REQUIRE_API_KEY`                 | `false`                                 | Require API keys on `/v1/*` routes and protected health endpoints |
| `BASE_URL`                        | `http://localhost:20128`                | Internal base URL for self-referencing API calls                  |
| `CLOUD_URL`                       | _(none)_                                | URL of self-hosted Cloudflare Worker (cloud deployment)           |
| `NEXT_TELEMETRY_DISABLED`         | `1`                                     | Disable Next.js telemetry                                         |
| `SEMANTIC_CACHE_MAX_BYTES`        | `4194304`                               | Semantic cache max size in bytes                                  |
| `SEMANTIC_CACHE_MAX_SIZE`         | `100`                                   | Semantic cache max entries                                        |
| `SEMANTIC_CACHE_TTL_MS`           | `1800000`                               | Semantic cache TTL (ms)                                           |
| `PROMPT_CACHE_MAX_BYTES`          | `2097152`                               | Prompt cache max size in bytes                                    |
| `PROMPT_CACHE_MAX_SIZE`           | `50`                                    | Prompt cache max entries                                          |
| `PROMPT_CACHE_TTL_MS`             | `300000`                                | Prompt cache TTL (ms)                                             |
| `REDIS_URL`                       | _(none)_                                | Redis connection URL for distributed rate limiting                |
| `POD_MAX_REQUEST_BODY_BYTES`      | `52428800` (50MB)                       | Max request body bytes for non-chat routes                        |
| `POD_MAX_CHAT_BODY_BYTES`         | inherits `POD_MAX_REQUEST_BODY_BYTES`   | Max request body bytes for chat/completions routes                |
| `IFLOW_OAUTH_CLIENT_SECRET`       | _(optional)_                            | Required for iFlow OAuth flows or token refresh                   |
| `QODER_OAUTH_CLIENT_ID`           | _(optional)_                            | Optional Qoder OAuth client ID override                           |
| `QODER_OAUTH_CLIENT_SECRET`       | _(optional)_                            | Required for Qoder OAuth flows                                    |

## API Endpoints

All endpoints accept `Authorization: Bearer <key>` or `x-api-key: <key>` when API key auth (`REQUIRE_API_KEY`) is enabled.

| Endpoint                         | Protocol               |
| -------------------------------- | ---------------------- |
| `POST /v1/chat/completions`      | OpenAI Chat            |
| `POST /v1/messages`              | Anthropic Messages     |
| `POST /v1/responses`             | OpenAI Responses       |
| `POST /v1/embeddings`            | OpenAI Embeddings      |
| `POST /v1/audio/speech`          | OpenAI TTS             |
| `POST /v1/audio/transcriptions`  | OpenAI STT             |
| `POST /v1/audio/translations`    | OpenAI Translations    |
| `POST /v1/images/generations`    | OpenAI Image Gen       |
| `POST /v1/images/edits`          | OpenAI Image Edit      |
| `POST /v1/images/variations`     | OpenAI Image Variation |
| `POST /v1/moderations`           | OpenAI Moderations     |
| `POST /v1/messages/count_tokens` | OpenAI Token Count     |
| `GET /v1/models`                 | OpenAI Model List      |
| `GET /v1/models/{model}`         | OpenAI Model Detail    |
| `POST /v1/files`                 | OpenAI File Upload     |
| `DELETE /v1/files/{file_id}`     | OpenAI File Delete     |
| `GET /v1/files/{file_id}`        | OpenAI File Retrieve   |
| `POST /v1/api/chat`              | Ollama Chat            |

Internal endpoints (dashboard, monitoring, health) are documented in `docs/API_INTERNAL.md`.

## Supported Providers

Provider definitions live in `src/shared/constants/providers.ts`. Categories include:

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
bun run lint         # oxlint lint
bun run check        # oxfmt + oxlint + tsc (--noEmit)
bun run test:run     # vitest run (verbose)
bun run test:coverage # vitest with coverage
```

Always run `bun run check && bun run test:run && bun run build` before pushing.

See [AGENTS.md](AGENTS.md) for project rules. Additional agent context in `.agents/`.

## Repository Map

| Path        | Purpose                                          |
| ----------- | ------------------------------------------------ |
| `src/`      | App layer (pages, API routes, lib, shared, SSE)  |
| `open-sse/` | Local engine fork (routing, translation, stream) |
| `cloud/`    | Cloudflare Worker backend                        |
| `tests/`    | Vitest test suite (unit + smoke)                 |
| `docker/`   | Dockerfile and docker-compose.yml                |
| `docs/`     | Internal API reference                           |
| `.agents/`  | Architecture, knowledge, issues, reports, plans  |

## License

[MIT](https://github.com/lazuardytech/pod/blob/main/LICENSE) — Copyright (c) 2024-2026 Lazuardy Technology and contributors.
