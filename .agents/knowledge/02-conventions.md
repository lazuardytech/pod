# Conventions

- **Naming:** PascalCase components, camelCase utilities, kebab-case API routes
- **Product name:** "pod" (lowercase, internal)
- **Imports:** ESM only, `@/` alias → `src/`
- **Components:** `ConfirmModal` over `window.confirm()`, `bg-primary` + `text-primary-fg` pairing
- **API safety:** `sanitizeError()` in catch blocks, `parseJsonBody()` for mutations, never return raw upstream errors
- **Storage:** Prefer `localDb.js` and `src/lib/sqlite/connection.js`
- **Versioning:** Bump in both `package.json` AND `src/shared/constants/config.js`
- **Dashboards:** Top-level pages, no `/dashboard` prefix
- **Commits:** Conventional Commits (feat, fix, etc.)
- **Engine:** Local `open-sse` fork, never npm
