<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Google-style auth UX

- **Plan**: context/changes/google-style-auth-ux/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3, 4
- **Date**: 2026-11-18
- **Verdict**: REJECTED (triaged — all 3 findings FIXED; verdict after fixes: APPROVED)
- **Findings**: 1 critical, 2 warnings, 0 observations — all FIXED

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | FAIL |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Findings

### F1 — resolveSafeRedirect's own origin check is bypassable via dot-segment tricks

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/app/login/safe-redirect.ts:24-28
- **Detail**: `resolveSafeRedirect("/.//evil.com", currentOrigin, fallback)` resolves via `new URL("/.//evil.com", currentOrigin)` to `origin === currentOrigin` (passing the check) but `pathname === "//evil.com"` — a protocol-relative string returned unchanged, exactly the attack class the function's own doc comment claims to close. Independently verified: `new URL("/.//evil.com", "https://example.com").pathname` → `"//evil.com"` (same for `/..//evil.com`). Today's single call site (`page.tsx` → next-auth's `signIn({redirectTo})`) happens to be safe only because next-auth's default `redirect` callback does string concatenation (`baseUrl + url`), turning it into a same-origin path — an incidental, undocumented property of a dependency, not something this function guarantees on its own.
- **Fix**: After computing the pathname+search+hash, reject (return `fallback`) if the result starts with `"//"`. Add `/.//evil.com` and `/..//evil.com` test cases to `safe-redirect.test.ts`.
- **Decision**: FIXED

### F2 — Dialog-outside-dropdown composition has no anti-pattern comment

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/user-menu.tsx (around the `<AlertDialog>` block)
- **Detail**: The confirm dialog is correctly rendered as a controlled sibling of `DropdownMenu`, not nested via `AlertDialogTrigger` inside a `DropdownMenuItem` — but unlike this change's other non-obvious decisions, this one has no rationale comment. A future edit could easily "simplify" it back into the anti-pattern that was deliberately avoided.
- **Fix**: Add a short comment above the `<AlertDialog>` block stating why it's a sibling with controlled state, not a nested trigger.
- **Decision**: FIXED

### F3 — SignInButton/SignOutButton use default exports, deviating from the codebase convention

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/app/login/_components/sign-in-button.tsx:7, src/components/sign-out-button.tsx:6
- **Detail**: Every other component in these directories and across the codebase uses named exports. These two are the only default-exported components introduced by this change — not a functional bug, just a two-file deviation.
- **Fix**: Change both to named exports and update their one import site each.
- **Decision**: FIXED
