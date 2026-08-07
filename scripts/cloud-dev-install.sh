#!/usr/bin/env bash
# Idempotent install for Cursor Cloud agent Builds (pod).
# Keep long-running services out of this script — use cloud-dev-start.sh / start.
set -euo pipefail

export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
export PATH="$BUN_INSTALL/bin:$PATH"

if ! command -v bun >/dev/null 2>&1; then
  curl -fsSL https://bun.sh/install | bash
  export BUN_INSTALL="$HOME/.bun"
  export PATH="$BUN_INSTALL/bin:$PATH"
fi

# Native deps used by trustedDependencies (better-sqlite3, sharp)
if ! command -v make >/dev/null 2>&1 || ! command -v g++ >/dev/null 2>&1; then
  sudo apt-get update -qq
  sudo apt-get install -y -qq build-essential python3
fi

cd /workspace
bun install --frozen-lockfile
