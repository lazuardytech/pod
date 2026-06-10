<img width="1700" height="600" alt="Pod" src="https://github.com/user-attachments/assets/f606d37c-769a-4f54-8f03-b7cbda7ac780" />


# ✦ Pod

Unified proxy for LLM inference. Pod sits in front of your AI providers and exposes a single OpenAI-compatible endpoint — with routing, fallback, caching, rate limiting, and a dashboard built in.

<code>🚧 under active development on v0.0.x</code>

<br/>

## Features

- **Multi-provider routing** — OpenAI, Anthropic, Gemini, Codex, Ollama, 50+ providers
- **Compatibility APIs** — OpenAI, Anthropic, Gemini, and Ollama-compatible endpoints under `/v1/*`
- **Semantic cache** — deduplicates identical requests; streaming responses are cached too
- **Conversational memory** — automatic injection and extraction across sessions
- **API key auth** — per-key rate limiting (req/min + concurrent cap)
- **Rate limiting** — Redis-backed distributed rate limiter with in-memory fallback
- **Combos** — model groups with fallback and round-robin strategies
- **Proxy pools** — per-provider proxy config with optional Vercel relay
- **Tunnel support** — Tailscale and Cloudflare tunnel integration
- **Dashboard** — full web UI for providers, usage analytics, quota tracking, logs, and health
- **Account lockout** — exponential cooldown on auth failures, visible on /health
- **PWA & offline-first** — installable dashboard with service worker shell caching, offline read cache, and offline mutation queue
- **Robust cache invalidation** — versioned service worker, network-first non-hashed assets, and tag-based offline JSON cache invalidation after safe mutations

<br/>

## Quick Start

### Docker (recommended)

```bash
docker run -d \
  --name pod \
  -p 20128:20128 \
  -v pod-data:/app/data \
  lazuardytech/pod:latest
```

Then open `http://localhost:20128`.

### Docker Compose (with Redis + SearXNG)

```bash
cd docker
docker compose up -d
```

This starts Pod, Redis (rate limiting), and SearXNG (private web search) together. Works out of the box.

With an env file:

```bash
docker run -d \
  --name pod \
  -p 20128:20128 \
  -v pod-data:/app/data \
  --env-file .env \
  lazuardytech/pod:latest
```

### Local Development

Requires [bun](https://bun.sh) v1.3.14+.

```bash
bun install
bun run dev        # starts on http://localhost:20128
```

<br/>

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `20128` | HTTP port |
| `DATA_DIR` | `~/.pod` locally, `/app/data` in Docker | SQLite data directory override |
| `INITIAL_PASSWORD` | `123456` | Initial dashboard login password. Change after first login. |
| `JWT_SECRET` | _(required)_ | Required server secret for dashboard auth sessions |
| `API_KEY_SECRET` | _(required)_ | Required HMAC secret used for generated Pod API keys |
| `SHUTDOWN_SECRET` | _(none)_ | Shared secret required by `/api/restart` and `/api/shutdown` |
| `MACHINE_ID_SALT` | `endpoint-proxy-salt` | Salt used for machine-bound identifiers |
| `ENABLE_REQUEST_LOGS` | `false` | Enable request log capture at runtime |
| `OBSERVABILITY_ENABLED` | `true` | Enable request-details observability storage |
| `OBSERVABILITY_MAX_RECORDS` | `200` | Max request-detail rows retained |
| `OBSERVABILITY_BATCH_SIZE` | `20` | Buffered write batch size for request details |
| `OBSERVABILITY_FLUSH_INTERVAL_MS` | `5000` | Max delay before flushing buffered request details |
| `OBSERVABILITY_MAX_JSON_SIZE` | `5` | Max stored JSON payload size in KiB per request-detail blob |
| `AUTH_COOKIE_SECURE` | `false` | Force secure auth cookies even outside HTTPS autodetection |
| `REQUIRE_API_KEY` | `false` | Require Pod API keys on `/v1/*` routes and protected health/model-list endpoints |
| `BASE_URL` | `http://localhost:20128` | Internal base URL used for self-referencing API calls (e.g. model availability checks). Set this when running behind a reverse proxy. |
| `CLOUD_URL` | _(none)_ | URL of your self-hosted Cloudflare Worker (cloud deployment). Overrides the value stored in settings. |
| `NEXT_TELEMETRY_DISABLED` | `1` | Disable Next.js telemetry |
| `SEMANTIC_CACHE_MAX_BYTES` | `4194304` | Semantic cache max size in bytes |
| `SEMANTIC_CACHE_MAX_SIZE` | `100` | Semantic cache max entries |
| `SEMANTIC_CACHE_TTL_MS` | `1800000` | Semantic cache TTL (ms) |
| `PROMPT_CACHE_MAX_BYTES` | `2097152` | Prompt cache max size in bytes |
| `PROMPT_CACHE_MAX_SIZE` | `50` | Prompt cache max entries |
| `PROMPT_CACHE_TTL_MS` | `300000` | Prompt cache TTL (ms) |
| `REDIS_URL` | _(none)_ | Redis connection URL for distributed rate limiting. When set, rate limits are shared across all Pod instances. When unset, falls back to in-memory rate limiting (single-instance only). Example: `redis://localhost:6379` |
| `IFLOW_OAUTH_CLIENT_SECRET` | _(optional)_ | Required only if you use iFlow OAuth flows or token refresh |
| `QODER_OAUTH_CLIENT_ID` | _(optional)_ | Optional Qoder OAuth client id override |
| `QODER_OAUTH_CLIENT_SECRET` | _(optional)_ | Required only if you use Qoder OAuth flows needing a client secret |

### Redis (optional)

Pod supports Redis-backed distributed rate limiting. When `REDIS_URL` is set, API key rate limits (`requests_per_minute`, `concurrent_requests`) are enforced globally across all Pod instances sharing the same Redis — preventing limit bypass in multi-instance deployments.

With docker compose:

```yaml
environment:
  REDIS_URL: redis://redis:6379
```

Without Redis, rate limiting uses an in-memory backend (single-instance safe, but not shared across replicas). Redis is recommended for production multi-instance deployments.

<br/>

## API

Pod exposes standard-compatible endpoints:

| Endpoint | Protocol |
|---|---|
| `POST /v1/chat/completions` | OpenAI |
| `POST /v1/messages` | Anthropic |
| `POST /v1/responses` | OpenAI Responses |
| `POST /v1/embeddings` | OpenAI |
| `POST /v1/audio/speech` | OpenAI TTS |
| `POST /v1/audio/transcriptions` | OpenAI STT |
| `POST /v1/images/generations` | OpenAI |
| `GET /v1/models` | OpenAI |
| `GET /v1beta/models` | Gemini |
| `POST /v1/api/chat` | Ollama |

All endpoints accept `Authorization: Bearer <key>` or `x-api-key: <key>` when API key auth is enabled.

<br/>

## Supported Providers

Canonical built-in provider definitions live in `src/shared/constants/providers.js`.

- Free access: Kiro AI, Qwen Code, Gemini CLI, iFlow AI, OpenCode Free
- Free tier or account/API-key based access: OpenRouter, NVIDIA NIM, Ollama Cloud, Vertex AI, Gemini, Cloudflare, BytePlus ModelArk
- OAuth and tool-account providers: Claude Code, Antigravity, OpenAI Codex, GitHub Copilot, Cursor IDE, Kilo Code, Cline
- API key and self-hosted providers: GLM Coding, GLM (China), Kimi, Minimax Coding, Minimax (China), Alibaba, Alibaba Intl, Xiaomi MiMo, Volcengine Ark, OpenAI, Anthropic, OpenCode Go, Azure OpenAI, DeepSeek, Groq, xAI (Grok), Mistral, Together AI, Fireworks AI, Cerebras, Cohere, Nebius AI, SiliconFlow, Hyperbolic, Blackbox AI, Chutes AI, Ollama Local, Vertex Partner
- Speech, embeddings, image, and search providers: Deepgram, AssemblyAI, NanoBanana API, ElevenLabs, Cartesia, PlayHT, Local Device, Google TTS, Edge TTS, Coqui TTS, Tortoise TTS, Inworld TTS, Voyage AI, SD WebUI, ComfyUI, HuggingFace, Tavily, Brave Search, Serper, Exa, SearXNG, Google PSE, Linkup, SearchAPI, You.com Search, Firecrawl, Fal.ai, Stability AI, Black Forest Labs, Recraft, Topaz, Runway ML, AWS Polly, Jina AI, Jina Reader
- Custom nodes: OpenAI-compatible, Anthropic-compatible, and custom embedding nodes can be added from the dashboard

<br/>

## Development

```bash
bun install          # install dependencies
bun run dev          # start dev server on :20128
bun run build        # production build
bun run check        # biome format + lint + eslint
bun run test:run     # run vitest
```

> Always run `bun run check` and `bun run test:run` before pushing.

See [AGENTS.md](AGENTS.md) for project rules (applies to both humans and AI agents). Additional agent context lives in `.agents/`.
See [docs/API_INTERNAL.md](docs/API_INTERNAL.md) for the dashboard/internal API reference.

<br/>

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

> Pod is heavily inspired by [9router](https://9router.com) and [OmniRoute](https://omniroute.online). Credits to their maintainers.

<br/>

## Security

See [SECURITY.md](SECURITY.md) for the vulnerability disclosure policy.

<br/>

## License

[MIT](https://github.com/lazuardytech/pod/blob/main/LICENSE) — Copyright (c) 2024–2026 Lazuardy Technology and contributors.
