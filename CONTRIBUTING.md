# Contributing to Pod

Thank you for your interest in contributing. This document covers how to get started, the development workflow, and what we expect from contributions.

## Table of Contents

- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Code Style](#code-style)
- [Commit Messages](#commit-messages)
- [Pull Requests](#pull-requests)
- [Reporting Bugs](#reporting-bugs)
- [Requesting Features](#requesting-features)
- [AI Agents](#ai-agents)

---

## Getting Started

**Requirements:**
- [bun](https://bun.sh) v1.3.14+
- Node.js is not required for running the app, but vitest uses it for tests

```bash
git clone https://github.com/lazuardytech/pod.git
cd pod
bun install
bun run dev        # starts on http://localhost:20128
```

---

## Development Workflow

Always use `bun` — never `npm` or `pnpm`.

```bash
bun run dev          # dev server
bun run build        # production build
bun run check        # biome format + biome lint + oxlint (run before every push)
bun run test:run     # vitest (run before every push)
```

**Before opening a PR, verify all of these pass:**

```bash
bun run check
bun run test:run
bun run build
```

CI runs the same steps and will block merge on failure.

---

## Code Style

- **JavaScript only** — no TypeScript. ESM import/export style.
- Formatting and linting are enforced by [Biome](https://biomejs.dev) + ESLint. Run `bun run check` to auto-fix.
- Follow existing file and naming conventions:
  - Components: `PascalCase.js`
  - Utilities/libs: `camelCase.js`
  - Next.js route segments: `kebab-case` folders
- Use `@/` alias for `src/` imports. Use `open-sse/*` for the local engine — do not install it from npm.
- Use `src/lib/localDb.js` and `src/lib/sqlite/connection.js` for all persistence. Do not bypass the storage facade.
- Use `<ConfirmModal>` from `@/shared/components/Modal` for all confirmation dialogs — never `window.confirm()`.
- Use `text-primary-fg` for text on `bg-primary` backgrounds — never `text-white` or `text-black`.
- Page-level header action buttons go through `src/store/headerActionStore.js`, not inline in the Header component.

See [AGENTS.md](AGENTS.md) and `.agents/knowledge/06-conventions.md` for the full conventions reference.

---

## Commit Messages

Use the [Conventional Commits](https://www.conventionalcommits.org/) format:

```
<type>(<scope>): <short summary>
```

Common types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`.

Examples:
```
feat(cache): add TTL config via env vars
fix(sse): attach abort listener to prevent timer leak
docs: update CONTRIBUTING.md
chore: bump version to v0.0.15
```

Keep the summary under 72 characters. Use the body for context if needed.

---

## Pull Requests

1. Fork the repo and create a branch from `main`.
2. Name your branch descriptively: `feat/semantic-cache-ttl`, `fix/sse-abort-leak`.
3. Keep PRs focused — one concern per PR.
4. Fill in the PR description: what changed, why, and what was tested.
5. Bump both version fields if your change warrants a release:
   - `package.json` → `"version"`
   - `src/shared/constants/config.js` → `displayVersion`
6. All CI checks must pass before merge.

---

## Reporting Bugs

Open a [GitHub Issue](https://github.com/lazuardytech/pod/issues) with:

- Pod version (visible on `/health` or in `package.json`)
- Steps to reproduce
- Expected vs actual behavior
- Relevant logs (from `/logs` → Console Logs or Docker logs)

For security vulnerabilities, **do not open a public issue** — see [SECURITY.md](SECURITY.md).

---

## Requesting Features

Open a [GitHub Issue](https://github.com/lazuardytech/pod/issues) with the `enhancement` label. Describe:

- The problem you are trying to solve
- Your proposed solution or approach
- Any alternatives you considered

---

## AI Agents

If you are an AI agent contributing to this repo:

1. Read [AGENTS.md](AGENTS.md) fully before making any changes.
2. Read `.agents/INDEX.md` and follow links to relevant knowledge files.
3. Use `bun` exclusively — never `npm` or `pnpm`.
4. Run `bun run check` and `bun run test:run` before finishing any task.
5. Never push directly to `main` — always use a branch.

---

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
