# Dev Workflow

- **Setup:** `bun install` (never npm/pnpm)
- **Dev server:** `bun run dev` → :20128 (Next.js turbopack)
- **Format/Lint:** `bun run check` (Biome + ESLint)
- **Test:** `bun run test:run` (Vitest)
- **Build:** `bun run build` (standalone output)
- **Pre-push:** `bun run check && bun run test:run && bun run build`
- **Workflow rules:**
  - Update docs from live code
  - Small verifiable changes
  - Verify routing/auth/stream
- **Thinking fix:** After any translator changes, verify thinking content doesn't leak into content field
