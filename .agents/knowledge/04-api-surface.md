# API Surface

## Compatibility Endpoints

- OpenAI-style: `/v1/chat/completions`, `/v1/responses`, `/v1/embeddings`, etc.
- Anthropic-style: `/v1/messages`, `/v1/messages/count_tokens`
- Gemini-style: `/v1beta/models` and subpaths

## Dashboard/Management Endpoints

- Providers, API keys, combos, settings, usage, proxy pools, tunnels, health

## Auth and Rate Limit Rules

- `/v1/*` write routes enforce API key rate limiting
- Model-list routes enforce auth when `requireApiKey=true`
- `/api/monitoring/health` mirrors auth behavior
- `/api/health` is always public heartbeat

## Streaming Endpoints

- Usage, request logs, proxy pools, health streams
- SSE cap: 100 connections per route
- SSE idle timeout: 5 minutes
