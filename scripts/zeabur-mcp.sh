#!/usr/bin/env bash
# Zeabur MCP wrapper: launches the official @zeabur/mcp-server with the
# ZEABUR_TOKEN read from .env (gitignored) so the secret never lands in
# committed config such as .hoplite/settings.json.
set -euo pipefail

cd "$(dirname "$0")/.."

token="$(grep -E '^ZEABUR_TOKEN=' .env 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"' || true)"
if [ -z "$token" ]; then
  echo "ZEABUR_TOKEN not set in .env (see scripts/zeabur-mcp.sh)" >&2
  exit 1
fi

export ZEABUR_TOKEN="$token"
exec npx -y @zeabur/mcp-server
