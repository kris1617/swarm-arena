---

name: code-review
description: Review code changes against team engineering conventions, testing standards and security expectations.
---

# Code Review

Review the current diff (or the files the user names) against the team's
engineering conventions below. Do not invent review standards beyond these —
they are the team's own source of truth, not a generic style guide.

## Naming

- Variables and functions use descriptive camelCase; no abbreviations except
  `url`, `id`, `api`, `config`.
- Booleans are prefixed with `is`, `has`, `should`, or `can`.
- Functions are verb-first (`getUserById`, not `user`).
- A file's name matches its primary export (`UserService.ts` exports
  `UserService`).
- Constants use `UPPER_SNAKE_CASE`.

## Error Handling

- Every async operation is wrapped in `try`/`catch` or has a `.catch()`.
- Error messages state what operation failed and the relevant inputs.
- No empty `catch` blocks — at minimum, log or rethrow the error.
- HTTP errors include a status code and an actionable message.
- Cleanup of opened resources belongs in a `finally` block.

## TypeScript

- Zero `any` without an explicit justification comment.
- Prefer `interface` over `type` for object shapes.
- External data comes in as `unknown` and is narrowed with type guards.
- States are modeled with discriminated unions, not optional fields.
- Generic parameters use descriptive names (`TUser`, not `T`).

## Function Design

- Single responsibility — if the function needs "and" to describe it, split
  it.
- Max 3 parameters; use an options object beyond that.
- Early returns over nested conditionals.
- Query functions (`get*`, `find*`, `is*`) are pure.

## Security

- No secrets in code — environment variables only.
- User input is validated at system boundaries.
- SQL uses parameterized statements only.
- API responses never leak stack traces or internal paths.

## Testing

- Test names describe behavior (e.g. "returns empty array when no results
  found"), not implementation.
- Each test owns its own setup and teardown.
- Assertions are specific (`toEqual(expected)`, not `toBeTruthy()`).
- Edge cases are covered: empty, null, boundary values and error paths.

## Output Format

Organize findings by severity, in this order:

1. **Critical** — breaks the above rules in a way that risks correctness,
   security, or data integrity.
2. **Warning** — violates a convention without an immediate safety impact.
3. **Suggestion** — a smaller improvement worth noting but not blocking.

Each finding includes a `file:line` reference whenever one is available, the
convention it violates, and a concrete fix.

Finish the review with exactly one of:

- `APPROVE` — no Critical or Warning findings remain unaddressed.
- `REQUEST CHANGES` — at least one Critical finding, or Warning findings the
  reviewer judges must be fixed before merge.
- `NEEDS DISCUSSION` — the review surfaced a tradeoff or ambiguity the
  conventions don't resolve, and a human decision is needed before approving
  or requesting changes.
