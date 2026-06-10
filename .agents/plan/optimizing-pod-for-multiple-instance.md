# Plan: Multi-Instance Pod

Status: planning

## Goal

Make Pod safe to run behind multiple replicas without losing correctness in stateful behavior.

## Required Building Blocks

1. Shared or replicated durable data strategy for SQLite-backed state
2. Redis-backed distributed rate limiting
3. Clear primary/replica behavior for writes
4. Deployment-safe persistent volumes
5. Revalidation of cache, memory, logs, and lock semantics in multi-instance mode

## Current Constraint

The repo is optimized first for single-instance correctness. Multi-instance support is an infrastructure and consistency project, not a simple scaling toggle.
