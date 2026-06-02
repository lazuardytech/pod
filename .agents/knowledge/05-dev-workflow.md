# Dev Workflow

## Package Manager

Use **bun only**.

## Main Commands

```bash
bun install
bun run dev
bun run check
bun run test:run
bun run build
```

## Release Checklist

1. `bun run check`
2. `bun run test:run`
3. `bun run build`
4. Bump both version fields:
   - `package.json`
   - `src/shared/constants/config.js` (`displayVersion`)
5. Tag release and push

## Docker Notes

- Image: `lazuardytech/pod`
- Runtime command: `bun /app/server.js`
- No `--smol` flag
