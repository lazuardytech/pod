# Provider Architecture

## Provider Flow

```
config definitions → auth resolution → credential refresh → executor dispatch → format translation → response normalization
```

Each provider passes through this pipeline for every request. The pipeline fails early (e.g., missing credentials or expired token) before reaching the upstream API.

## Auth Types

| Auth Type | Providers |
|---|---|
| OAuth | Claude, GitHub |
| API key | OpenAI, Groq, Perplexity, OpenRouter |
| Cookie / session | Web-based providers |
| Local | Ollama |
| Service account | Vertex AI (GCP) |

Credentials are managed through `open-sse/services/` and refreshed as needed before executor dispatch.

## Executor Routing

- **DefaultExecutor**: Handles most OpenAI-compatible providers.
- **Specialized executors**: Claude (thinking blocks), Gemini (stream format), Vertex AI (GCP auth + no `stream` field in body), Kiro (transient overload body-gating).

Executors live in `open-sse/executors/`. Each implements the same interface so the handler can dispatch generically.

## Format Translation

`open-sse/translator/` handles all format pairs:

- OpenAI → Claude
- Claude → OpenAI
- Gemini → OpenAI
- OpenAI → Gemini

The translator is a TransformStream pipeline that runs on every streaming response.

## Current Rules

- **Lockout/cooldown preservation**: When a provider returns rate-limit or overload errors, the system records a cooldown period and avoids dispatching to that provider until it expires.
- **Provider-specific retry**: Retry relay once on `502` or `504` (Vercel relay). Kiro retry is body-gated on transient overload markers.
- **Aligned model listing**: `/v1/models` reports models from all configured providers, unified under a common schema.
- **Compatible-node isolation**: Provider-node rename applies only to compatible/custom nodes.
- **Expect provider drift**: Provider APIs change. Executors and translators are designed to isolate provider-specific quirks so a change in one provider doesn't ripple across the system.
