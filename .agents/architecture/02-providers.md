# Provider Integrations

Pod supports 50+ AI providers through a multi-layer integration system: configuration, credential management, token refresh, format translation, and specialized executors.

## Provider Architecture

```
config/providers.js                    ← Static config (URLs, formats, auth methods)
       │
       ▼
src/sse/services/auth.js               ← Credential resolution + lockout
       │
       ▼
services/tokenRefresh.js               ← OAuth refresh flows
       │
       ▼
executors/index.js                      ← Executor dispatch
       │
       ├── default.js (40+ providers)
       └── specialized/ (codex, cursor, vertex, kiro, etc.)
```

## Provider Config (`open-sse/config/providers.js`)

Each provider has:
```javascript
{
  id: "claude",                          // Internal ID
  kind: "llm",                           // llm, embedding, image, tts, stt
  name: "Claude",                        // Display name
  format: "claude",                      // Target format (claude, openai, gemini, cursor...)
  baseUrl: "https://api.anthropic.com",  // Primary URL
  baseUrls: [...],                       // Fallback URLs (multi-region)
  authMethod: "oauth",                   // oauth, apikey, cookie, noauth
  headers: { "anthropic-version": "..." },
  clientId: "...",
  clientSecret: "...",
  authEndpoint: "...",
  tokenEndpoint: "...",
  scope: "...",
  models: [...],                         // Model list for listing endpoint
}
```

### Provider Kinds
| Kind | Count | Description |
|------|-------|-------------|
| `llm` | 50+ | Text/chat completion |
| `embedding` | 15+ | Text embeddings |
| `image` | 15+ | Image generation |
| `tts` | 7+ | Text-to-speech |
| `stt` | 3+ | Speech-to-text |
| `search` | 5+ | Web search |
| `fetch` | 3+ | Web content fetch |
| `video` | 2+ | Video models |
| `music` | 2+ | Music models |

### Auth Methods
| Method | Providers | Flow |
|--------|-----------|------|
| OAuth | Claude, Codex, Gemini CLI, GitHub, Qwen, iFlow, Kiro, Cursor, Antigravity | Browser-based authorize → callback → token exchange → refresh |
| API Key | OpenAI, DeepSeek, Groq, xAI, Mistral, Together, Cerebras, Cohere, 20+ more | User provides key in dashboard |
| Cookie | Grok Web, Perplexity Web | Browser session cookie extraction |
| No Auth | Ollama, SD WebUI, ComfyUI | Local services, no credentials needed |
| Service Account | Vertex AI | JSON key file → JWT minting |
| PAT | GitLab | Personal Access Token |

## Credential Management (`src/sse/services/auth.js`)

### `getProviderCredentials(providerId)`
1. Resolve provider alias → provider ID
2. Get all connections from SQLite for this provider
3. Filter locked accounts:
   - **Connection-level lockout**: Connection locked for `1h × lockCount` (exponential: 1h, 2h, 3h...)
   - **Model-level lockout**: `modelLock_${modelId}` field check
   - **Provider daily limit**: daily token/request count exceeded
4. Apply selection strategy:
   - `fill-first`: Use first available account until rate-limited
   - `round-robin`: Rotate through accounts with sticky limit
5. Cache connections for 1s TTL (reduce DB queries)

### `markAccountUnavailable(connectionId, status, errorText)`
- 401 (suspicious-activity, credentials-expired) → Connection-level lockout
- 403 (forbidden, billing) → Connection-level lockout
- 429 (rate limit) → Model-level lockout
- 402 (payment) → Connection-level lockout
- `lockCount` × 1h cooldown, resets on first success
- Max lock: 24h cap

### `clearAccountError(connectionId)`
- Clears connection lockout and model locks on successful request
- Resets lockCount to 0

## Token Refresh (`services/tokenRefresh.js` + `src/sse/services/tokenRefresh.js`)

### In-Flight Dedup
```javascript
// Same provider+token shares a single refresh promise
const inflightRefresh = new Map()
const key = `${provider}_${tokenHash}`
if (inflightRefresh.has(key)) return inflightRefresh.get(key)
```

### Provider-Specific Flows

| Provider | Flow |
|----------|------|
| Claude | OAuth2 with PKCE, refresh_token grant, `anthropic-beta: claude-code-*` header |
| Codex (OpenAI) | OAuth2 with PKCE, `openid offline_access model.read` scopes |
| Gemini CLI | OAuth2 device flow, Google Identity Services |
| GitHub | OAuth2 device flow, `user:email read:user` scopes |
| Qwen | OAuth2 code flow, `qwen-code` specific endpoints |
| iFlow | OAuth2 + cookie exchange |
| Kiro | AWS SSO (device code) + Social login (Kakao/Google → exchange) |
| Cursor | Token import (IDE-embedded tokens) + auto-detect from config files |
| Vertex AI | Service Account JSON → JWT via `jose`, `https://www.googleapis.com/auth/cloud-platform` |
| Antigravity | Google OAuth2, antigravity-specific endpoints |
| Grok Web | Cookie extraction (no refresh — re-extract on expiry) |
| Perplexity Web | Cookie extraction (no refresh) |
| GitLab | PAT (no refresh — user re-provides) |

### Retry Logic
```javascript
refreshWithRetry(refreshFn, maxAttempts = 3)
// Delays: 1s, 2s, 3s (exponential)
// Unrecoverable detection: refresh_token_reused, invalid_grant → stop
```

### Proactive Refresh
`checkAndRefreshToken(connection)`: Refreshes if token expires within 5 minutes (Claude), 10 minutes (GitHub/Gemini), or 15 minutes (others).

## Provider Aliases

Users can reference providers via short aliases in model strings:

| Alias | Provider | Format |
|-------|----------|--------|
| `cc` | Claude | claude |
| `cx` | Codex | openai-responses |
| `gc` | gemini-cli | gemini |
| `qw` | Qwen | qwen |
| `if` | iFlow | iflow |
| `ag` | Antigravity | antigravity |
| `gh` | GitHub | openai |
| `kr` | Kiro | kiro |
| `cu` | Cursor | cursor |
| `kmc` | kimi-coding | openai |
| `cl` | Cline | openai |
| `cmd` | CommandCode | commandcode |

Direct provider IDs (openai, deepseek, groq, etc.) work without alias translation.

## Compatible Nodes

Custom endpoints that conform to known API formats:

- `openai-compatible-*`: OpenAI format, custom baseUrl from credential `api_url` field
- `anthropic-compatible-*`: Claude format, `x-api-key` auth, custom `api_url`
- `custom-embedding-*`: Custom embedding endpoint, configurable dimensions

Provider nodes support rename (custom-only), test, and clear-connection-lock operations.

## Error Classification for Fallback

### Priority: Text Rules → Status Rules

**Text Rules** (checked in error body first):
- "daily token limit" → Until midnight local time
- "rate limit" → 60s cooldown
- "quota exceeded" → 2min cooldown
- "capacity" → 30s cooldown
- "overloaded" → 15s cooldown
- "model_temporarily_unavailable" → 5s cooldown (Kiro-specific)

**Status Rules** (fallback when no text match):
- 401/403: 2min cooldown (connection-level)
- 429: Exponential backoff via `ERROR_RULES`
- 502/504: Retry with next URL (not account fallback)
- 500: Depends on transient body pattern (Kiro: truncated)

### Cooldown Math
```javascript
// Connection-level: lockCount × 1h
cooldownMs = Math.min(lockCount * 3600000, 86400000)  // max 24h

// Model-level: fixed intervals
cooldownMs = modelSpecificTimeout  // from errorConfig
```
