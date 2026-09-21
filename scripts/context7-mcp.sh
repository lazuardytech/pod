#!/usr/bin/env bash
# Context7 MCP wrapper: stdio fallback that does not depend on the Hoplite
# dashboard OAuth connection. Key precedence: platform-injected env var,
# then gitignored .env; runs anonymously (rate-limited) when absent.
set -euo pipefail

cd "$(dirname "$0")/.."

key="${CONTEXT7_API_KEY:-}"
if [ -z "$key" ] && [ -f .env ]; then
  key="$(grep -E '^CONTEXT7_API_KEY=' .env 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"' || true)"
fi

if [ -n "$key" ]; then
  exec npx -y @upstash/context7-mcp --api-key "$key"
fi
echo "CONTEXT7_API_KEY not set — running anonymously (lower rate limits)" >&2
exec npx -y @upstash/context7-mcp
