# 9router v0.4.40 → v0.4.62 — Pod Adoption Report

> **Date:** 2026-05-26
> **Pod baseline:** v0.0.44
> **9router latest:** v0.4.62 (2026-05-26, ~6h ago)
> **Range covered:** v0.4.40 (~2026-05-13) through v0.4.62

Pod and 9router diverged at pod's v0.0.1 rebrand. Adoption is per-feature, never wholesale merge. Items below are filtered against pod's non-negotiable rules (`AGENTS.md` 1–21) and gotchas (`07-gotchas.md`) — anything that would re-introduce removed features (MITM, `/dashboard` prefix, npm/pnpm, `--smol`) is auto-skipped.

## Release-by-release scan

### v0.4.62 (2026-05-26) — Codex stability + Antigravity 2.x
- ✅ **Sanitize Read tool args** (PR #1144, #1354) — strip `pages: ""` in OpenAI→Claude
- ✅ **json_schema fallback for `openai-compatible-*`** (PR #1343)
- ✅ **Codex auto-retry on stream drop**
- ⚠️ **Codex 400/404, tool-calling, prompt cache fixes** — needs commit-level diff
- 🟦 **MITM Antigravity 2.x** — N/A (MITM removed v0.0.4)
- ✅ **Gemini `outputDimensionality` for embeddings** (PR #1366)
- ⚠️ **setState-in-effect** (PR #1362) — pod has no `LanguageSwitcher`; `UsageStats` needs review
- ✅ **Gemini CLI projectId reuse** (PR #1271, #1428) — pod already ahead
- ✅ **Reduce fetch connect timeout 30s → 20s**
- ✅ **Tunnel refactor (CF/Tailscale)** — pod already modular
- ✅ **tokenRefresh in-flight dedup** — pod already has 2-layer dedup
- ❌ **Cloudflare Workers proxy deployer** (PR #1360) — feature decision required
- ❌ **Deno Deploy relays** (PR #1437) — feature decision required

### v0.4.59 (2026-05-21) — OAuth Windows fix
- ⚠️ **OAuth login fix on Windows** — pod is server-side, may not apply (Windows OAuth bug was Electron-specific)

### v0.4.58 (2026-05-21) — xAI Grok + Stream pipe fix
- ⚠️ **xAI Grok OAuth** — pod has API key + web cookie, OAuth flow not present
- ❌ **Provider limits paginated accounts** — pod's per-provider quota UI may benefit
- 🟦 **Tailscale Windows status (#1300)** — Electron-specific, pod is server
- ✅ **Stream pipe errors on client disconnect/abort** — pod has SSE abort guard (gotcha #32)
- ⚠️ **Tunnel false-positive reachability check** — pod's `pingTunnelHealth` may have similar issue, check

### v0.4.55 (2026-05-18) — MITM fix, Xiaomi regions, AG risk modal
- 🟦 **MITM macOS sudo lsof** — N/A
- 🟦 **Antigravity OAuth metadata match** — check if pod's Antigravity OAuth has parity issue
- ✅ **Stream stall false-positive on Claude reasoning / Kiro** — pod has 3-min STALL_TIMEOUT_MS
- ⚠️ **Xiaomi MiMo region selector (SG/CN/EU)** — pod has Xiaomi provider, may benefit from region split
- ❌ **Antigravity risk confirmation dialog** — UX nice-to-have
- ❌ **Gemini CLI surface 429 retry-delay** — UX, low effort
- ⚠️ **Tunnel re-enable stuck state** — pod already fixed similar in v0.0.42 (`5f25ba7`), verify symptom match
- ⚠️ **Cloudflared error log tail in error message** — UX, would be useful in pod tunnel UI
- 🟦 **Language switcher locale apply** — N/A (pod English-only)
- ⚠️ **Gemini CLI engine bump 0.34.0** — pod tracks via `geminiEngineVersion`, check current version

### v0.4.52 (2026-05-17) — Vercel AI Gateway + Kiro RTK
- ❌ **Vercel AI Gateway provider** (PR #1183) — new provider, feature decision
- ⚠️ **Kiro RTK conversationState compression** (PR #1194) — pod has Kiro RTK at body level, verify history-level coverage
- ⚠️ **openclaw agent.model normalization** (PR #1216) — check pod's openclaw executor for `{primary, fallbacks}` form
- ⚠️ **Usage Details mobile pagination viewport <640px** (PR #1218) — pod's `/usage` Details was just rebuilt in v0.0.43, verify
- ⚠️ **MIMO provider Codex fix** — pod's Xiaomi+Codex routing may have same issue
- 🟦 **Disable log file when MITM AG** — N/A

### v0.4.50 (2026-05-16) — tray fixes + Shutdown button
- 🟦 **macOS tray duplicate icon** — N/A (pod has no tray, server-only)
- 🟦 **Tray hide-to-tray Win/Linux** — N/A
- ❌ **Shutdown button in web UI** — pod doesn't have one, low priority

### v0.4.49 (2026-05-16) — Kiro provider + RTK buildOutput
- ✅ **Kiro provider full translation** — pod present
- ❌ **buildOutput RTK filter (npm/yarn/cargo)** — port to `open-sse/rtk/filters/buildOutput.js`
- ⚠️ **OpenCode modalities (input/output)** — check pod's opencode model config
- 🟦 **Tray hide-to-tray macOS** — N/A
- 🟦 **systray2 fork (Kaspersky AV)** — N/A
- ⚠️ **Hide deprecated providers (qwen, iflow, antigravity)** — pod still has these visible? Check
- 🟦 **i18n 32 languages** — N/A
- ⚠️ **Model check (test-models) machineId CLI token** — pod's test-models flow may need same auth path

### v0.4.46 (2026-05-15) — tunnel domain switch
- 🟦 **Tunnel public URL change** — N/A (pod uses its own tunnel infrastructure)

### v0.4.44 (2026-05-15) — Blackbox + Xiaomi providers
- ❌ **Blackbox provider with `bb` alias** (PR #1143) — new provider, feature decision
- ✅ **Xiaomi token plan provider** — pod has Xiaomi
- ⚠️ **Model select modal UX + traffic lights** (PR #1111) — pod uses `<ModelSelectModal>`, check if this UX is desirable
- ⚠️ **Default Usage dashboard period to Today** (PR #1141) — pod's `/usage` defaults? Check
- 🟦 **Cowork model selection Win CLI packaging** (PR #1129) — N/A
- ⚠️ **Compatibility provider name retrieval** (PR #1135) — check `openai-compatible-*` provider name lookup
- ⚠️ **JWT_SECRET handling update** — security hardening, check pod's JWT path

### v0.4.41 (2026-05-14) — CLI Tools redesign + jcode + TUI
- 🟦 **jcode CLI integration** (PR #1047) — pod has CLI Tools but not jcode, low priority unless requested
- ❌ **CLI Tools dashboard grid 1/2/3 cols + detail page per tool** — pod uses simpler list, design decision
- ✅ **Drag-and-drop reordering for combo models** (PR #1108) — pod has @dnd-kit, verify combo reorder present
- ⚠️ **Today period in Usage** (PR #1063) — same as v0.4.44 item
- ❌ **DeepSeek V4 Pro effort aliases** (PR #950) — check pod's DeepSeek V4 model list
- 🟦 **Autostart nvm + npm 9/10 launchctl** (PR #1104) — N/A (pod is server)
- ⚠️ **Ollama usage not tracked** (PR #1102) — check pod's usage tracking for ollama
- ⚠️ **Opencode preserve DeepSeek reasoning** (PR #1099) — check pod's opencode reasoning
- 🟦 **TUI input lag fix** — N/A (pod has no TUI)
- ⚠️ **API key row actions on mobile** (PR #1112) — UI fix, check pod's `/endpoint` mobile

### v0.4.39, v0.4.38 (2026-05-13/14) — Docker fixes
- 🟦 **Docker `/app/server.js` regression** — pod's Dockerfile is independent
- 🟦 **`Cannot find module next` standalone build** — pod has its own standalone setup

### v0.4.37 (2026-05-13) — Security hardening
- ⚠️ **Security hardening (unspecified)** — opaque release note, would need diff inspection

### v0.4.36 (2026-05-13) — MiniMax TTS + Docker Hub
- ✅ **MiniMax TTS provider** (PR #1043) — pod has it
- ✅ **Replace browser confirm with ConfirmModal** (PR #1060) — pod rule #5 enforced
- 🟦 **Docker Hub + GHCR dual publish** — pod uses Docker Hub `lazuardytech/pod`
- ⚠️ **Docker `Cannot find module next`** (#1064, #1067) — N/A if pod's standalone works
- 🟦 **CLI TUI menu arrow-key escape sequences** — N/A
- 🟦 **systray2 fork** — N/A
- ⚠️ **Topology zoom controls dark contrast** (#1066) — pod uses `@xyflow/react`, check zoom button contrast in dark theme

## Categorized adoption plan

### Adopt now (low-risk, clearly beneficial)

| # | Item | Source | Files (pod) | Effort |
|---|------|--------|-------------|--------|
| 1 | Sanitize Read `pages` arg | v0.4.62 PR #1144, #1354 | `open-sse/translator/request/openai-to-claude.js` | XS |
| 2 | json_schema fallback for `openai-compatible-*` | v0.4.62 PR #1343 | `open-sse/executors/default.js` `transformRequest` | S |
| 3 | Gemini `outputDimensionality` for embeddings | v0.4.62 PR #1366 | `open-sse/handlers/embeddingProviders/gemini.js` | XS |
| 4 | Connect timeout 20s | v0.4.62 | `open-sse/utils/proxyFetch.js` (undici `ProxyAgent`) | XS |
| 5 | Codex auto-retry on stream drop | v0.4.62 | `open-sse/handlers/chatCore/streamingHandler.js` + `open-sse/executors/codex.js` | M |
| 6 | buildOutput RTK filter | v0.4.49 | new `open-sse/rtk/filters/buildOutput.js` + `rtk/registry.js` | S |
| 7 | Linux/arm64 Docker | v0.4.31 (still relevant) | `.github/workflows/docker-publish.yml`, `Dockerfile` | XS |

### Adopt with caveats (worth doing, needs adaptation)

| # | Item | Source | Caveat |
|---|------|--------|--------|
| 8 | Cloudflared error log tail in error UI | v0.4.55 | Pod's `pingTunnelHealth` already sanitizes errors (rule #18). Add log tail capture without re-leaking raw errors. |
| 9 | Stream pipe errors on client abort | v0.4.58 | Pod has gotcha #32 abort handling. Audit all SSE handlers to confirm, fix any laggards. |
| 10 | Kiro RTK conversationState history compression | v0.4.52 PR #1194 | Pod's `compressMessages` runs on body before split — verify it actually reaches `history[].userInputMessage`. |
| 11 | Antigravity OAuth metadata match official client | v0.4.55 | Compare `src/lib/oauth/services/antigravity.js` against current AG official client metadata. |
| 12 | Xiaomi MiMo region split | v0.4.55 | Region selector adds 3 endpoints per account. Worth it if pod users use non-SG region. |
| 13 | Gemini CLI 429 retry-delay surfacing | v0.4.55 | UX: show upstream `retry-after` to user instead of generic 429. |
| 14 | Provider limits paginated accounts | v0.4.58 | Pod's quota UI shows all accounts; pagination useful at scale. |
| 15 | DeepSeek V4 Pro effort aliases | v0.4.41 PR #950 | Verify pod's DeepSeek model list includes effort variants. |
| 16 | Ollama usage tracking | v0.4.41 PR #1102 | Verify pod's usage events include ollama provider. |
| 17 | Opencode DeepSeek reasoning preservation | v0.4.41 PR #1099 | Check pod's opencode/openclaw executor `reasoning_content` propagation. |
| 18 | openclaw agent.model normalization (`{primary, fallbacks}`) | v0.4.52 PR #1216 | Pod's openclaw must handle object form before `.startsWith` to avoid TypeError. |
| 19 | Hide deprecated providers (qwen, iflow, antigravity if EOL) | v0.4.49 | Verify which providers are still active in pod. |
| 20 | Topology zoom controls dark contrast | v0.4.36 PR #1066 | Pod uses Linear design; ensure zoom buttons use `text-primary-fg` per rule #11. |
| 21 | Drag-and-drop combo models | v0.4.41 PR #1108 | Pod has `@dnd-kit` for connections; verify combos also have it. |

### Skip (not relevant or already present)

| Item | Reason |
|------|--------|
| MITM Antigravity 2.x, MITM macOS sudo lsof, MITM JSON cache, Linux NSS cert injection, AG MITM log file disable | MITM removed v0.0.4, gotcha #15 |
| Tray fixes (macOS dup icon, Win/Linux hide, systray2 Kaspersky, NSStatusItem ghost) | Pod is server-only, no tray |
| TUI input lag, CLI TUI escape sequences, jcode CLI tool | Pod has no TUI |
| Autostart nvm/launchctl | Pod is Docker/server, not user-launched |
| Tailscale Windows status, OAuth Windows fix | Pod is server-side, Electron-specific bugs |
| i18n 32 languages, language switcher locale apply | Pod is English-only |
| Tunnel domain switch (v0.4.46) | Pod has its own tunnel infrastructure |
| Docker Hub + GHCR dual publish | Pod uses Docker Hub `lazuardytech/pod` exclusively |
| Docker `Cannot find module next`, `/app/server.js` regression | Pod's Dockerfile is independent |
| `bun:sqlite` adapter v0.4.28 | Pod has been bun-only since v0.0.1 |
| developer→system role normalization | Pod has 3-layer normalization |
| OAuth callback postMessage origins (CWE-1385) | Pod hardened with explicit threat model |
| TLS verify on DNS-bypass (CWE-295) | DNS-bypass removed in pod |
| MiniMax TTS, xAI Grok web/api | Pod has both |
| Tunnel CF/Tailscale module split | Pod already modular (`src/lib/tunnel/`) |
| tokenRefresh dedup | Pod has 2-layer dedup, ahead of upstream |
| Gemini CLI projectId reuse | Pod has `projectId.js` service with TTL cache + abort, ahead |
| Stream stall timeout 3min | Pod has it (`open-sse/utils/stream.js:91`) |
| ConfirmModal replacement | Pod rule #5 enforced project-wide |

### Diverged (different paths — do not merge)

| Item | Pod | 9router |
|------|-----|---------|
| Cloudflare Workers proxy deployer | Pod's `cloud/` is static deploy via `wrangler.toml` | Per-user dashboard deploy flow |
| Deno Deploy relays | Not present | New proxy-pool type |
| OIDC dashboard SSO | Password-only (`PROTECTED_API_PATHS` + `INITIAL_PASSWORD`) | Authentik/Keycloak/Google/Okta |
| MCP stdio→SSE bridge | Not present | `/api/mcp/[plugin]/sse` and `/message` |
| Vercel AI Gateway provider | Not present (pod has Vercel Relay = proxy pool, not gateway) | Provider |
| Blackbox provider, jcode CLI tool | Not present | Present |
| CLI Tools dashboard layout | Simpler list | Grid 1/2/3 cols + detail page per tool |
| Tray / Electron | Server-only | Electron app with tray |

## Suggested execution order

If implementing the "Adopt now" set in one pass:

1. **#1, #3, #4** — single-line/single-file fixes. Bundle into one commit. Effort: ~30min.
2. **#7 Linux/arm64 Docker** — independent infra change. Test image build for both architectures. Effort: ~30min.
3. **#2 json_schema fallback** — needs care: detect `provider.startsWith("openai-compatible-")` in `executors/default.js` `transformRequest`, inject schema into system message, downgrade `response_format.type` to `"json_object"`. Add unit test. Effort: ~1h.
4. **#6 buildOutput RTK filter** — new file, mirror existing filter shape (`gitDiff.js`, `grep.js`). Add to `rtk/registry.js`. Add unit test with sample npm/yarn/cargo logs. Effort: ~1.5h.
5. **#5 Codex stream-drop retry** — wrap upstream fetch in `streamingHandler.js`, detect early disconnect (no `[DONE]`), reissue with backoff. Most complex. Effort: ~3h with tests.

After "Adopt now" lands as v0.0.45 or v0.0.46, do a focused pass on the "Adopt with caveats" items by triaging which actually affect pod (many need verification before they're confirmed gaps).

## Things to verify in pod first (cheap)

Before porting, confirm these pod-side states with grep/read:

- **#10 Kiro RTK history coverage** — does `compressMessages` actually compress inside `kiro` `history[].userInputMessage` chunks?
- **#15 DeepSeek V4 Pro effort aliases** — `src/shared/constants/providers.js` deepseek model list
- **#16 Ollama usage** — `open-sse/usage/` records ollama provider events?
- **#17 Opencode reasoning** — `open-sse/executors/openclaw.js` (or opencode) preserves `reasoning_content` from DeepSeek?
- **#18 openclaw agent.model object form** — `open-sse/executors/openclaw.js` handle `{primary, fallbacks}` before `.startsWith`?
- **#19 deprecated providers visible** — `src/shared/constants/providers.js` for qwen/iflow/antigravity flags

These verifications can be batched into a single grep pass before deciding which "with caveats" items become "adopt now."
