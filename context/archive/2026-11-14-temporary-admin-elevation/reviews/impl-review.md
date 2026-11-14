<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Time-boxed, self-service admin elevation for any account

- **Plan**: context/changes/temporary-admin-elevation/plan.md
- **Scope**: Full plan (Phases 1–3)
- **Reviewed phases**: 1, 2, 3
- **Date**: 2026-11-14
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | WARNING |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — Duplicate `<main>` landmark on the new elevation page

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architecture
- **Location**: src/app/admin/elevation/page.tsx:16 (also pre-existing at src/app/admin/settings/page.tsx:20, out of this change's scope)
- **Detail**: `AppShell`'s `SidebarInset` (`src/components/ui/sidebar.tsx:305`) already renders the page's one `<main>` landmark for every authenticated page. The new `admin/elevation/page.tsx` renders its own root `<main>`, producing two nested `main` landmarks — an explicit AGENTS.md rule violation ("A page's own root element... must be a `<div>`, never another `<main>`"). It copied the pattern from the pre-existing `admin/settings/page.tsx`, so it propagates rather than introduces the bug, but it's new code in this diff.
- **Fix**: Change the root element in `src/app/admin/elevation/page.tsx` from `<main className="...">` to `<div className="...">`.
- **Decision**: FIXED

### F2 — `account.email ?? ""` fallback on revoke could send an empty email

- **Severity**: ℹ️ OBSERVATION
- **Dimension**: Safety & Quality
- **Location**: src/app/admin/elevation/_components/elevation-form.tsx:151
- **Detail**: `listElevatedAccounts` selects `email`, which per the NextAuth-adapter-shaped schema can theoretically be null. Falling back to `""` would send an empty string to `revertAccount`, which Zod rejects with a 400 — harmless but a confusing error instead of simply disabling the row's Revoke button.
- **Fix**: Disable the Revoke button (or skip rendering the row) when `account.email` is null/empty, rather than relying on the server's validation error.
- **Decision**: SKIPPED — low-impact, server already rejects cleanly

### F3 — Duration input isn't hard-clamped client-side

- **Severity**: ℹ️ OBSERVATION
- **Dimension**: Pattern Consistency
- **Location**: src/app/admin/elevation/_components/elevation-form.tsx (duration `Input`); server cap in src/server/api/routers/user.ts (`MAX_DURATION_MINUTES = 1440`, enforced via shared Zod schema)
- **Detail**: The duration `Input` sets `min`/`max` as HTML attributes only; a user can type e.g. `99999` with no immediate client feedback until the server's Zod `.max(1440)` rejects it with a generic tRPC error shown via `.error.message`. Server-side enforcement (the plan's actual requirement) is correct and the error does surface in the UI — just a slightly rough UX, not a defect.
- **Fix**: Optional — clamp the input value on change/blur to [1, 1440] for immediate feedback.
- **Decision**: SKIPPED — server enforcement is correct; cosmetic UX only

## Notes

- All 3 phases verified MATCH against the plan (schema, migration, `isEffectivelyAdmin`, all 5 `userRouter` procedures, `root.ts` registration, `adminProcedure` wiring, env flag, both admin pages, the new elevation page/form).
- Mid-Phase-3 bug fix (session `elevatedUntil` serialized as string/number, not a `Date`, by the time any consumer reads it — `isEffectivelyAdmin` and the `Session.user` type widened to `Date | string | null`) is a justified, narrowly-scoped fix discovered during manual verification, not scope creep.
- Security-critical items from the plan-review (F1: `ALLOW_SELF_ELEVATION` gate; F2: case-insensitive email lookup via parameterized `lower()`) are both correctly implemented and covered by tests.
- No injection risk, no missing authz boundary, no swallowed errors, no partial-write window found.
- Automated checks (typecheck, lint, full test suite, hardcoded-value scan) and the full manual-verification checklist (self-elevate/revert, cross-account elevate/revoke, non-admin rejection, lapsed-grant auto-expiry, `/admin/settings` redirect) all passed live against the running dev server.
