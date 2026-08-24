# Provider Architecture

## Request Pipeline

```
config definitions → auth resolution → credential refresh → executor dispatch → format translation → response normalization
```

Each request passes through this pipeline. Fails early on missing credentials or expired tokens.

## Provider Categories

| Category                          | Providers                                                                                                                                                                                                                                                      |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Free access                       | Kiro AI, Qwen Code, Gemini CLI, iFlow AI, OpenCode Free                                                                                                                                                                                                        |
| Free tier / API key               | OpenRouter, NVIDIA NIM, Ollama Cloud, Vertex AI, Gemini, Cloudflare, BytePlus ModelArk                                                                                                                                                                         |
| OAuth / tool-account              | Claude Code, Antigravity, OpenAI Codex, GitHub Copilot, Cursor IDE, Kilo Code, Cline                                                                                                                                                                           |
| API key / self-hosted             | OpenAI, Anthropic, Azure OpenAI, DeepSeek, Groq, xAI, Mistral, Together AI, Fireworks AI, Cerebras, Cohere, Nebius AI, SiliconFlow, Hyperbolic, Ollama Local, GLM, Kimi, Minimax, Alibaba, Xiaomi MiMo, Volcengine Ark, Blackbox AI, Chutes AI, Vertex Partner |
| Media (speech/image/embed/search) | Deepgram, AssemblyAI, ElevenLabs, Voyage AI, SD WebUI, ComfyUI, Tavily, Brave Search, SearXNG, Fal.ai, Stability AI, Jina AI, and more                                                                                                                         |
| Custom nodes                      | OpenAI-compatible, Anthropic-compatible, custom embedding nodes (added from dashboard)                                                                                                                                                                         |

Provider definitions live in `src/shared/constants/providers.ts` (`AI_PROVIDERS`: **84** built-in ids — 5 free / 7 free-tier / 7 OAuth / 63 API-key / 2 cookie). Tables above are examples, not exhaustive. Custom OpenAI/Anthropic/embedding nodes are extra. Model catalogs in `src/shared/constants/models.ts`.

## Auth Types

| Type             | Mechanism                                | Examples                                     |
| ---------------- | ---------------------------------------- | -------------------------------------------- |
| API key          | Bearer token or `x-api-key` header       | OpenAI, Groq, DeepSeek, Mistral              |
| OAuth            | Token refresh via provider-specific flow | Claude, Codex, Cursor, Copilot, GitHub       |
| Cookie / session | Browser session scraping                 | Web-based providers (Perplexity, Grok, etc.) |
| Local            | Direct connection                        | Ollama Local                                 |
| Service account  | GCP IAM                                  | Vertex AI                                    |
| Free             | No credentials needed                    | Kiro, Qwen Code, Gemini CLI, iFlow           |

Token refresh logic lives in `open-sse/services/tokenRefresh.ts` with provider-specific refreshers for Claude, Codex, Copilot, GitHub, Google, iFlow, and Qwen.

## Executor Routing

Executors live in `open-sse/executors/` (20 files: 17 specialized + `default.ts` + `base.ts` + `index.ts`). `getExecutor()` maps 19 keys; unknown providers get `DefaultExecutor`.

| Executor                         | Provider(s)            | Notable behavior                           |
| -------------------------------- | ---------------------- | ------------------------------------------ |
| `default.ts`                     | Most OpenAI-compatible | Standard passthrough                       |
| `vertex.ts`                      | Vertex AI              | GCP auth + strips `stream` field from body |
| `kiro.ts`                        | Kiro AI                | Transient overload body-gating for retry   |
| `codex.ts`                       | OpenAI Codex           | Reasoning token budget normalization       |
| `ollama-local.ts`                | Ollama                 | Local endpoint handling                    |
| `antigravity.ts`                 | Antigravity            | OAuth-based                                |
| `cursor.ts`                      | Cursor IDE             | OAuth-based                                |
| `github.ts`                      | GitHub Copilot         | OAuth token refresh                        |
| `grok-web.ts`                    | xAI Grok (web)         | Cookie-based                               |
| `perplexity-web.ts`              | Perplexity (web)       | Cookie-based, x-pod-skip-reasoning         |
| `iflow.ts`                       | iFlow AI               | Free access                                |
| `qoder.ts`                       | Qoder                  | OAuth-based                                |
| `qwen.ts`                        | Qwen Code              | Free access                                |
| `opencode.ts` / `opencode-go.ts` | OpenCode               | Free access                                |
| `commandcode.ts`                 | Command Code           | OAuth-based                                |
| `gemini-cli.ts`                  | Gemini CLI             | Free access                                |
| `azure.ts`                       | Azure OpenAI           | API key                                    |

## Format Translation

`open-sse/translator/` handles all format pairs via TransformStream pipelines:

| Translation     | Direction                                           |
| --------------- | --------------------------------------------------- |
| OpenAI → Claude | Client sends OpenAI format, provider expects Claude |
| Claude → OpenAI | Provider sends Claude format, client expects OpenAI |
| Gemini → OpenAI | Provider sends Gemini format, client expects OpenAI |
| OpenAI → Gemini | Client sends OpenAI format, provider expects Gemini |

The translator is applied on every streaming response.

## Provider Rules

| Rule                                                                                                                           | Rationale                           |
| ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------- |
| Vertex AI: never include `stream` in request body                                                                              | Vertex handles streaming internally |
| Vercel relay: timeout = pod timeout - 5s, retry once on 502/504                                                                | Platform timeout guard              |
| Kiro: retry body-gated on transient overload markers                                                                           | Avoid retrying permanent errors     |
| Compatible-node rename: only for compatible/custom nodes                                                                       | Don't rename built-in providers     |
| Thinking blocks: never emit `<think>`/`</think>` in content delta                                                              | Client compatibility                |
| Outbound proxy: pools (http + Vercel relay) and SOCKS resolved via `src/lib/network/connectionProxy.ts` (pool → legacy → none) | Per-request egress control          |

## Account Lockout & Cooldown

When a provider returns rate-limit or overload errors:

1. Record a cooldown period with exponential multiplier
2. Avoid dispatching to that provider until cooldown expires
3. Lockout status visible on `/health` page
4. Connection-level lockdown with exponential cooldown (v0.0.75+)

Account fallback logic lives in `open-sse/services/accountFallback.ts`.
