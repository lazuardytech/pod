#!/usr/bin/env bash
# Zeabur MCP wrapper: launches the official @zeabur/mcp-server with the
# ZEABUR_TOKEN. Precedence: platform-injected env var, then gitignored .env —
# the secret never lands in committed config such as .hoplite/settings.json.
set -euo pipefail

cd "$(dirname "$0")/.."

token="${ZEABUR_TOKEN:-}"
if [ -z "$token" ] && [ -f .env ]; then
  token="$(grep -E '^ZEABUR_TOKEN=' .env 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"' || true)"
fi
if [ -z "$token" ]; then
  echo "ZEABUR_TOKEN not set (env var or .env — see scripts/zeabur-mcp.sh)" >&2
  exit 1
fi

export ZEABUR_TOKEN="$token"
exec npx -y @zeabur/mcp-server
