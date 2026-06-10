# Report: Vercel Relay Robustness v0.0.55

## Summary

This work stabilized relay timeout behavior and cold-start retry handling.

## Lasting Rules

- Relay timeout stays 5 seconds shorter than Pod timeout.
- Retry relay once on `502` or `504`.
- Keep `google.com/generate_204` as the relay health target.
