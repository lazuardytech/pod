# Overview

Pod is a self-hosted AI gateway with a dark operational dashboard.

## What It Does

- Unifies many providers behind a stable client-facing API
- Manages credentials, refresh flows, retries, combos, and lockouts
- Tracks usage, health, logs, cache, and memory
- Supports tunnels, proxy pools, and offline-friendly dashboard behavior

## Current Repo Shape

- Frontend and API app: `src/`
- Inference engine: `open-sse/`
- Worker companion: `cloud/`
- Project docs: `.agents/`, `AGENTS.md`, `DESIGN.md`, `README.md`

## Fast Truth Sources

- `README.md`
- `AGENTS.md`
- `.agents/INDEX.md`
- `.env.example`
- live code in `src/`, `open-sse/`, and `cloud/`
