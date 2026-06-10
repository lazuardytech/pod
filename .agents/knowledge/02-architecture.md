# Architecture Summary

Pod has three main layers.

## 1. App Layer

Next.js pages, route handlers, middleware, dashboard UI, and PWA assets live in `src/`.

## 2. Engine Layer

`open-sse/` handles provider routing, translation, streaming, fallback, and upstream execution.

## 3. Data and Ops Layer

SQLite, rate limiting, memory, logs, cache, tunnels, and shutdown logic live mainly in `src/lib/` and `src/shared/services/`.

## Design Principle

Keep orchestration separated from provider-specific behavior and keep persistence concerns out of page components.
