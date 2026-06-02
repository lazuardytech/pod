# Edit Tool Guidelines

## 1) "Text Found Multiple Times"

Cause: the match is not unique.

Fix:
- Include 2-5 surrounding lines.
- Anchor with nearby unique code.

## 2) "Text Not Found"

Cause: `oldText` does not match exact current file content.

Fix:
- Re-read file right before edit.
- Copy exact whitespace and line breaks.
- Avoid guessed snippets.

## Practical Rules

1. Read first, edit second.
2. Use small, unique patch scopes.
3. Re-read after each successful edit before the next patch.
4. Prefer deterministic edits for repeated structures.
5. After non-trivial edits, run lint/build validation.
