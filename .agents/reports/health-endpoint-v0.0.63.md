# Report: Health Endpoint Enrichment v0.0.63

## Summary

The operational health surface was expanded so one endpoint can summarize key runtime signals.

## Lasting Rule

`/api/monitoring/health` is the detailed operational surface; `/api/health` remains the public heartbeat. **Update (2026-07):** monitoring health + stream are also **public reads** (API-key guard removed).
