# Engine Architecture — open-sse

The `open-sse/` directory is the core proxy engine. A local-only library (never from npm, resolved via `jsconfig.json` alias `"open-sse"` → `"./open-sse"`).

## Directory Map

```
open-sse/
├── index.js                    # Public API barrel (30+ exports)
├── config/                     # Static configuration
│   ├── providers.js            # 50+ provider definitions
│   ├── providerModels.js       # Model catalog per provider alias
│   ├── runtimeConfig.js        # HTTP status codes, retry defaults, timeouts
│   ├── errorConfig.js          # Error classification rules, backoff math
│   └── appConstants.js         # System prompts, OAuth endpoints, CLI versions
├── executors/                  # Per-provider upstream callers (20 files)
│   ├── base.js                 # BaseExecutor: fetch loop, URL fallback, retry
│   ├── default.js              # Default for 40+ OpenAI-compatible providers
│   └── specialized/            # codex, cursor, vertex, kiro, qwen, etc.
├── handlers/                   # Request orchestration layer
│   ├── chatCore.js             # Main pipeline: routing, cache, memory, dispatch
│   ├── responsesHandler.js     # /v1/responses adapter
│   ├── embeddingsCore.js       # Embeddings pipeline
│   └── chatCore/               # streamingHandler, nonStreamingHandler, sseToJsonHandler
├── services/                   # Cross-cutting services
│   ├── provider.js             # detectFormat, buildProviderUrl/Headers
│   ├── model.js                # parseModel, resolveAlias, getModelInfo
│   ├── tokenRefresh.js         # 15+ provider OAuth refresh flows
│   └── accountFallback.js      # Error classification, lockout, account filtering
├── translator/                 # Format translation pipeline
│   ├── index.js                # Registry: translateRequest, translateResponse
│   ├── request/                # Source → target translators (11 files)
│   ├── response/               # Provider → client translators (9 files)
│   └── helpers/                # claude, openai, gemini, responses helpers
├── transformer/                # Stream transformers
│   ├── responsesTransformer.js # Chat SSE → Responses API SSE
│   └── streamToJsonConverter.js # SSE → JSON
├── rtk/                        # Reasoning Toolkit (token savings)
│   ├── index.js                # compressMessages() entry
│   ├── autodetect.js           # Auto-detect compression filter
│   └── filters/                # gitDiff, grep, tree, ls, smartTruncate, etc.
└── utils/                      # Utilities
    ├── stream.js               # SSE TransformStream (passthrough + translate)
    ├── streamHandler.js        # Disconnect-aware stream controllers
    ├── proxyFetch.js           # Proxy-aware fetch + Vercel relay
    └── claudeCloaking.js       # Tool name cloaking/decloaking
```

## Request Pipeline

```
Client Request
  │
  ▼
handleChatCore()                              ← handlers/chatCore.js
  │
  ├─ bypass check (warmup, title gen, naming)
  ├─ semantic cache check (thundering herd)
  ├─ memory injection (if enabled)
  │
  ▼
Format Detection                              ← services/provider.js
  │ detectFormat(body) → OPENAI/CLAUDE/GEMINI/CURSOR/...
  │
  ├─ Native passthrough? (Claude CLI → Claude, Codex CLI → Codex)
  │   │ YES → skip translation, go direct
  │   ▼ NO
  │
  ▼
Request Translation                           ← translator/index.js
  │ sourceFormat → OPENAI (canonical) → targetFormat
  │
  ▼
RTK Compression                               ← rtk/index.js
  │ compressMessages(): tool_result content
  │ auto-detect filter type
  │
  ├─ Caveman injection (if enabled)
  ├─ Token budget reserve (openai-compatible-*)
  │
  ▼
Executor Selection                            ← executors/index.js
  │ getExecutor(providerId)
  │ specialized maps → codex, cursor, vertex, kiro, etc.
  │ fallback → DefaultExecutor (40+ providers)
  │
  ▼
Executor.execute()                            ← executors/default.js (or specialized)
  │ buildUrl + buildHeaders (token refresh if needed)
  │ proxyAwareFetch (env HTTP_PROXY or Vercel relay)
  │ URL fallback loop
  │ retry on 429/502/503/504
  │
  ▼
Response Dispatch
  │
  ├─ streaming → createSSEStream               ← utils/stream.js
  │   ├─ formats match → Passthrough mode
  │   └─ formats differ → Translate mode
  │       per-chunk: targetFormat → OPENAI → sourceFormat
  │       inject usage, reasoning_content
  │       graceful error on crash + controller.terminate()
  │
  ├─ JSON → translate body + save to cache      ← chatCore/nonStreamingHandler.js
  │
  └─ forced SSE→JSON → assemble chunks          ← chatCore/sseToJsonHandler.js
      (Codex + providers that only support SSE)

  │
  ▼
Response to Client
  │
  └─ Usage + request details persisted to SQLite
```

## Executor Architecture

### BaseExecutor (`base.js`)
- Fetch-with-retry loop
- URL fallback iteration (`baseUrls[0]` → `baseUrls[1]` → ...)
- Abort signal merging (client cancel + upstream timeout)
- 15s connect timeout
- `shouldRetry(status, urlIndex)`: 429/502/503/504 with remaining URLs

### DefaultExecutor (`default.js`)
- Handles 40+ OpenAI-compatible providers
- URL and header builder from provider config
- Token refresh dispatcher on 401
- `json_schema` → prompt injection for compat providers
- Reasoning content injector for thinking providers

### Specialized Executors
| Executor | Provider | Key Differences |
|----------|---------|-----------------|
| `codex.js` | Codex (OpenAI Responses API) | Session ID, image prefetch, Responses API normalization, tool allowlist, SSE overload peek + retry, model suffix for thinking effort, output_index remap |
| `cursor.js` | Cursor IDE | HTTP/2 + fetch dual transport, protobuf frame decompression (gzip/zlib/raw), SSE/JSON from protobuf |
| `vertex.js` | Vertex AI | JWT minting from service account JSON via jose, stream exclusion from body |
| `kiro.js` | Kiro (AWS) | Body-gated transient retry, `MODEL_TEMPORARILY_UNAVAILABLE` detection |
| `qwen.js` | Qwen Code | Qwen-specific auth + format |
| `ollama-local.js` | Ollama | Local http://localhost:11434, /api/tags model listing |
| `grok-web.js` | Grok Web | Cookie-based auth |
| `perplexity-web.js` | Perplexity Web | Cookie-based auth |

## Streaming Architecture

### Mode Selection
- Client `stream: true` OR `Accept: text/event-stream` → SSE
- Source format is Antigravity/Gemini/GeminiCLI → SSE
- Provider is openai or codex → SSE
- `stream: false` → JSON (forced)

### Passthrough Mode
When sourceFormat === targetFormat: bytes pass through, IDs normalized, usage injected, Azure fields stripped.

### Translate Mode
When formats differ: `createSSETransformStreamWithLogger` — per-chunk call to `translateResponse(targetFormat, sourceFormat, chunk, state)`.

### Crash Containment (v0.0.79)
Three containment points protect the entire pipeline:
1. `handlers/chat.js` `while(true)` loop: `try/catch` + `MAX_FALLBACK_ITERATIONS=50`
2. `utils/stream.js` `transform()`: `try/catch` + SSE error terminator + `controller.terminate()`
3. `handlers/chatCore.js` peek reader: `try/catch` on `getReader()` and `reader.read()`

## Fallback System

### Error Classification (`services/accountFallback.js`)
1. **Text rules** (checked first): "daily token limit", "rate limit", "quota exceeded", "capacity", "overloaded"
2. **Status rules** (fallback): 401/402/403 → 2min cooldown, 429 → exponential
3. Special: "daily token limit" → until midnight; per-minute → next minute boundary

### Lockout Levels
- **Connection-level**: 401/403 (suspicious-activity, credentials-expired) → entire connection locked for 1h × lockCount
- **Model-level**: 429/rate-limit → per-model cooldown via `modelLock_${model}`

### Token Refresh (`services/tokenRefresh.js`)
- In-flight dedup: same provider+token shares single refresh promise
- 15+ provider-specific flows
- `refreshWithRetry(fn, 3)` with exponential backoff: 1s, 2s, 3s
- Unrecoverable detection: `refresh_token_reused`, `invalid_grant` → stop retry, force re-auth

## Translator Pipeline

### Architecture
Request flow: `sourceFormat → OPENAI (canonical) → targetFormat`
Response flow: `targetFormat → OPENAI (canonical) → sourceFormat`

### Request Translators (11 files)
- `openai-to-claude.js`: Messages, tools, images, thinking, response_format, cache_control
- `openai-to-gemini.js`, `openai-to-vertex.js`, `openai-to-kiro.js`, `openai-to-cursor.js`
- `openai-to-ollama.js`, `openai-to-commandcode.js`, `openai-responses.js`
- `claude-to-openai.js`, `gemini-to-openai.js`, `antigravity-to-openai.js` (reverse)

### Response Translators (9 files)
- `claude-to-openai.js`, `gemini-to-openai.js`, `kiro-to-openai.js`
- `cursor-to-openai.js`, `ollama-to-openai.js`, `commandcode-to-openai.js`
- `openai-to-claude.js`, `openai-to-antigravity.js`, `openai-responses.js`

## RTK (Reasoning Toolkit)

Token savings system. Compresses `tool_result` content before sending to upstream provider.

### Flow
1. `compressMessages(messages)` → iterates tool results
2. `autodetect(content)` → matches filter type (git-diff, grep, tree, ls, etc.)
3. `applyFilter(content, type)` → runs compression filter
4. Caveman injection: terse system prompt for supported providers

### Filters
`gitDiff.js`, `gitStatus.js`, `grep.js`, `find.js`, `tree.js`, `ls.js`, `searchList.js`, `readNumbered.js`, `dedupLog.js`, `smartTruncate.js`, `buildOutput.js`
