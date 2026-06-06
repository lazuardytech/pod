# Request Flow — End to End

A complete walkthrough of a `/v1/chat/completions` request through Pod.

## Phase 1: HTTP Entry

```
Client → POST /v1/chat/completions
  Headers: Authorization, Content-Type, Accept
  Body: { model, messages, stream, tools, ... }
```

## Phase 2: Next.js Route Handler

```
src/app/api/v1/chat/completions/route.js
  │
  ├─ POST handler
  │
  ├─ CORS headers
  ├─ Content-Type validation
  ├─ Parse JSON body → parseJsonBody(request)
  │   └─ Malformed JSON → 400 Invalid JSON body
  │
  ├─ Extract API key from Authorization header
  ├─ Rate limit check → withApiKeyRateLimit(request, handler)
  │   └─ Exceeded → 429 with Retry-After header
  │
  └─ Delegate to handleChat()
```

## Phase 3: SSE Handler (Credential Layer)

```
src/sse/handlers/chat.js → handleChat()
  │
  ├─ Parse model string: "cc/claude-sonnet-4-6"
  ├─ Parse body options (stream, temperature, tools, etc.)
  │
  ├─ Resolve combo (if model name matches a combo)
  │   ├─ Combo found → expand into ordered fallback list
  │   └─ No combo → single model
  │
  ├─ Resolve model alias
  │   ├─ openai-compatible-* → Provider node with custom baseUrl
  │   ├─ anthropic-compatible-* → Provider node with x-api-key auth
  │   ├─ custom-embedding-* → Custom embedding node
  │   └─ Standard → parseProviderAlias()
  │
  └─ Credential fallback loop (while has credentials)
       │
       ├─ getProviderCredentials(providerId)
       │   ├─ Resolve alias → provider ID
       │   ├─ Get all connections for this provider
       │   ├─ Filter by locked accounts
       │   │   ├─ Connection lockout? (exponential cooldown)
       │   │   ├─ Model lockout? (per-model cooldown)
       │   │   └─ Provider-level rate limit?
       │   ├─ Apply strategy: fill-first / round-robin
       │   └─ Return next eligible connection
       │
       ├─ handleChatCore({ body, providerConfig, credentials })
       │   (Phase 4 — see below)
       │
       ├─ SUCCESS → break loop, return response
       │
       └─ FAILURE → markAccountUnavailable(status, errorText)
            ├─ 401/403 → Connection lockout (1h × lockCount)
            ├─ 429 → Model lockout
            ├─ 502/503/504 → Retry with next credential
            └─ Continue loop with next credential
```

## Phase 4: Engine Pipeline (open-sse)

```
open-sse/handlers/chatCore.js → handleChatCore()
  │
  ├─ Bypass check
  │   └─ Warmup, title generation, naming → skip cache/memory
  │
  ├─ Semantic cache check (with thundering herd prevention)
  │   ├─ HIT → return cached SSE/JSON directly
  │   └─ MISS → continue
  │
  ├─ Memory injection (if enabled)
  │   ├─ FTS5 search for relevant memories
  │   ├─ Format as system/user messages
  │   └─ Inject into body.messages
  │
  ├─ Format detection
  │   detectFormat(body) → OPENAI / CLAUDE / GEMINI / CURSOR / ...
  │
  ├─ Native passthrough gate
  │   ├─ Claude CLI → Claude format → skip translation
  │   ├─ Codex CLI → Codex format → skip translation
  │   └─ Otherwise → translate
  │
  ├─ Request translation
  │   translateRequest(sourceFormat, targetFormat, body)
  │   ├─ sourceFormat → OPENAI (canonical)
  │   ├─ OPENAI → targetFormat
  │   └─ Example: Claude → OPENAI → Gemini
  │
  ├─ RTK compression
  │   compressMessages(messages)
  │   ├─ Auto-detect filter (git-diff, grep, tree, etc.)
  │   └─ Compress tool_result content
  │
  ├─ Caveman injection (if enabled)
  │   injectCaveman(provider, messages)
  │
  ├─ Token budget reserve (openai-compatible-* only)
  │
  └─ Executor dispatch
       │
       ├─ getExecutor(providerId)
       │   └─ codex → CodexExecutor | cursor → CursorExecutor | ...
       │       otherwise → DefaultExecutor
       │
       └─ executor.execute(body, options)
            │
            ├─ buildProviderUrl(provider)
            ├─ buildProviderHeaders(provider, credentials)
            │   └─ Token refresh on 401 (in-flight dedup)
            │
            ├─ proxyAwareFetch(url, headers, body, proxyConfig)
            │   ├─ env HTTP_PROXY → proxy agent
            │   ├─ Vercel relay → x-relay-target headers
            │   └─ Direct → standard fetch
            │
            ├─ URL fallback loop (baseUrls[0] → [1] → ...)
            ├─ Retry on 429/502/503/504 (configurable)
            │
            └─ Return Response object
```

## Phase 5: Response Handling

```
Response from executor
  │
  ├─ Client wants streaming?
  │   │
  │   ├─ YES → createSSEStream(response.body)
  │   │   │
  │   │   ├─ Formats match → Passthrough mode
  │   │   │   ├─ Normalize SSE IDs
  │   │   │   ├─ Inject usage estimation
  │   │   │   └─ Strip Azure-specific fields
  │   │   │
  │   │   └─ Formats differ → Translate mode
  │   │       ├─ Per-chunk: translateResponse(targetFmt, sourceFmt, chunk)
  │   │       ├─ Inject reasoning_content placeholders
  │   │       └─ Graceful error: SSE error terminator + terminate()
  │   │
  │   └─ Pipe via pipeWithDisconnect() (abort on client disconnect)
  │
  ├─ Client wants JSON?
  │   │
  │   ├─ Provider returns SSE → handleForcedSSEToJson()
  │   │   └─ Read all SSE, assemble JSON
  │   │
  │   └─ Provider returns JSON → nonStreamingHandler()
  │       └─ Translate body, save to cache
  │
  └─ Inject usage tracking + request detail logging
```

## Phase 6: Cleanup

```
  │
  ├─ logUsage({ model, tokens, latency, ... })
  ├─ logRequest({ model, provider, status, ... })
  ├─ clearAccountError(connectionId) — clear locks on success
  └─ Return response to client
```

## Key Design Decisions

1. **Credential layer before engine.** Auth, rate limiting, and credential resolution happen in `src/sse/handlers/` before delegating to the format-agnostic `open-sse` engine. This separation keeps the engine focused on routing/translation/execution.

2. **OpenAI as canonical format.** All translations go through OpenAI format as the intermediary. This means N×M translation is reduced to N+M — each format only needs translators to/from OpenAI.

3. **Two-phase translation.** Requests: source → OpenAI → target. Responses: target → OpenAI → source. Bidirectional translation without combinatorial explosion.

4. **Native passthrough.** When a native client (Claude CLI, Codex CLI, Gemini CLI) connects to its matching provider, translation is skipped entirely. Only the credential/auth layer matters.

5. **Fallback loop, not chain.** Multiple credentials for the same provider are tried sequentially until one succeeds. On failure, the failed credential is locked (connection or model level). The loop continues with the next credential.

6. **Stream crash containment.** Three try/catch barriers protect the entire streaming pipeline. Any unexpected error is caught and surfaced as a graceful SSE termination, never a process crash.
