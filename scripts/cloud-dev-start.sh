#!/usr/bin/env bash
# Long-running pod dev server for Cursor Cloud agent sessions.
# Secrets must come from Cursor environment Secrets (not committed .env).
set -euo pipefail

export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
export PATH="$BUN_INSTALL/bin:$PATH"

: "${JWT_SECRET:?JWT_SECRET must be set (Cursor Cloud Agents → environment Secrets)}"
: "${API_KEY_SECRET:?API_KEY_SECRET must be set (Cursor Cloud Agents → environment Secrets)}"

export PORT="${PORT:-20128}"
export NODE_ENV="${NODE_ENV:-development}"
export NEXT_TELEMETRY_DISABLED="${NEXT_TELEMETRY_DISABLED:-1}"
export REQUIRE_API_KEY="${REQUIRE_API_KEY:-false}"
export AUTH_COOKIE_SECURE="${AUTH_COOKIE_SECURE:-false}"
export BASE_URL="${BASE_URL:-http://localhost:20128}"
export NEXT_PUBLIC_BASE_URL="${NEXT_PUBLIC_BASE_URL:-http://localhost:20128}"
export INITIAL_PASSWORD="${INITIAL_PASSWORD:-123456}"

cd /workspace
exec bun run dev
