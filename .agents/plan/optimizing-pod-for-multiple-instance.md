# Plan: Multi-Instance Pod

Status: **deferred — single-instance by design** (see [AGENTS.md §Operations rule 14](../../AGENTS.md#operations))

## Goal

Make Pod safe to run behind multiple replicas without losing correctness in stateful behavior.

## Required Building Blocks

1. Shared or replicated durable data strategy for SQLite-backed state
2. Redis-backed distributed rate limiting
3. Clear primary/replica behavior for writes
4. Deployment-safe persistent volumes
5. Revalidation of cache, memory, logs, and lock semantics in multi-instance mode

## Current Constraint

The repo is optimized first for single-instance correctness. Each Zeabur service (`pod`, `pod-canary`) has its own SQLite volume — auth state and `requireApiKey` are configured per-service. Multi-instance support is an infrastructure and consistency project, not a simple scaling toggle.

## Why Deferred

- Single-instance is the only supported mode in the current deployment topology.
- Stateless API tier is feasible today, but the durable state (SQLite, semantic cache, memory, lock counts) requires a primary/replica or shared-store design not yet picked.
- Will be reopened when usage justifies the engineering cost (≥2 replicas of `pod` for HA), or when a Zeabur Postgres add-on becomes the primary store.

## Scope Hint (if/when reopened)

The required building blocks above are concrete. Redis-backed distributed rate limiting is the easiest first slice; shared SQLite strategy is the hardest.
