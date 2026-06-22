# Overview

- **Pod:** self-hosted AI gateway unifying 50+ LLM providers behind a single OpenAI-compatible endpoint
- **Stack:** Bun + Next.js 16 (JS, no TS) + open-sse (local engine fork) + SQLite
- **Deployed at:** pod.lazuardy.tech (Zeabur, Cloudflare DNS)
- **Three layers:**
  - **App:** Next.js pages/routes/middleware/PWA
  - **Engine:** open-sse routing/translation/streaming
  - **Data & Ops:** SQLite, cache, rate limiting, tunnels
- **Repo structure:** `src/`, `open-sse/`, `cloud/` (Cloudflare Workers), `tests/`, `docs/`, `.agents/`
- **Key files:**
  - `AGENTS.md` — operational rules
  - `README.md` — quick start
  - `DESIGN.md` — UI system
  - `.agents/INDEX.md` — doc entry point
