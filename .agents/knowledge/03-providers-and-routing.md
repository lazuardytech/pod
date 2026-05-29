# Providers & Routing

## Configuration Sources

| File | Purpose |
|---|---|
| `open-sse/config/providers.js` | Transport config (base URL, format, headers) for 50+ providers |
| `open-sse/config/providerModels.js` | Per-model target format and strip rules |
| `open-sse/config/errorConfig.js` | Fallback/backoff/retry behavior |
| `src/shared/constants/providers.js` | Dashboard catalog + metadata |
| `src/shared/constants/models.js` | Static model catalog for UI |

## Routing Pipeline (Chat-Compatible Requests)

1. **Model resolution** (`sse/services/model.js`): parse `provider/model`, resolve aliases, detect combos
2. **Combo check** (`open-sse/services/combo.js`): expand model list with fallback/round-robin strategy
3. **Credential selection** (`sse/services/auth.js`): active-state checks, 3-tier lock system (connection/model/precise), strategy (round-robin with sticky limit, fill-first)
4. **Core execution** (`open-sse/handlers/chatCore.js`): translation, cache, memory, executor dispatch

## Fallback Layers (3 Levels)

1. **Combo-level**: Try next model in combo list
2. **Account-level**: Switch to next connection/API key (same provider)
3. **Token refresh/retry**: Inside executor path for auth-expired accounts

## Executors

Registry at `open-sse/executors/index.js`. Specialized executors for some providers (Kiro, Codex, etc.). Default executor for generic OpenAI-compatible providers.

## Format Translation

2-step pipeline: Source → OpenAI-normalized → Target format.

Supported formats: OPENAI, CLAUDE, GEMINI, VERTEX, CODEX, ANTIGRAVITY, KIRO, CURSOR, OLLAMA, OPENAI_RESPONSES, GEMINI_CLI.

Translators lazy-initialized at first request via `initTranslators()`.

## Provider Types

1. **Built-in API Key**: OpenAI, Anthropic, Google, etc.
2. **OAuth**: GitHub, Google/Kiro, Cursor, Codex, Qwen, GitLab, Claude, Gemini
3. **OpenAI/Anthropic Compatible**: User-defined with custom base URLs
4. **Free tier**: No-auth (opencode, etc.)
5. **Web cookie**: iFlow (BXAuth), grok-web, perplexity-web
6. **Custom Embedding**: User-defined embedding endpoints
