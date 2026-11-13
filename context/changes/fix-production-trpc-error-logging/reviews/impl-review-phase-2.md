<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Production error visibility

- **Plan**: context/changes/fix-production-trpc-error-logging/plan.md
- **Scope**: Phase 2 of 6
- **Reviewed phases**: 2
- **Date**: 2026-11-13
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 3 observations (1 fixed)

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Summary

Clean MATCH against the plan: `src/app/error.tsx` and `src/app/error.test.tsx`
exactly as specified — styling, logging, test structure all verified by
reading the files directly against `simulation/page.tsx`'s gradient pattern
and `button.tsx`'s API. Automated criteria re-run live: `npm run typecheck`,
`npm run check`, `npx vitest run src/app/error.test.tsx`, `npm test` all pass.

## Findings

### F1 — `error.tsx` was built against `reset`, but Next 16.3+'s stable prop is `retry`

- **Severity**: OBSERVATION (was going to be the only actionable one)
- **Impact**: 🏃 LOW — a straightforward rename once identified
- **Dimension**: Pattern Consistency / Architecture
- **Location**: `src/app/error.tsx`
- **Detail**: The plan's own contract specified `{ error, reset }`, matching training-data-era Next.js. Checked the real installed docs
  (`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md`):
  `retry` became the stable prop as of **v16.3.0** — this repo runs 16.4.5.
  `reset()` only clears local error state without re-fetching/re-rendering the
  segment; `retry()` actually re-fetches. `reset` is still supported (not
  removed), so this wasn't a functional bug, but it means the component was
  built against a contract this installed version no longer recommends —
  exactly the kind of drift `AGENTS.md` explicitly warns to check for ("This
  is NOT the Next.js you know... heed deprecation notices").
- **Fix**: Renamed the prop from `reset` to `retry` in both `error.tsx` and
  `error.test.tsx`, button now calls `retry()`.
- **Decision**: FIXED — `src/app/error.tsx`/`error.test.tsx` updated, full
  suite re-verified green (101/101) after the change.

### F2 — `error.digest` is typed but never surfaced

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Safety & Quality
- **Location**: `src/app/error.tsx`
- **Detail**: `digest` correlates a client-visible failure to server-side
  logs — relevant given this whole change is about closing production
  error-logging gaps — but isn't logged or shown. Not required by the plan's
  contract.
- **Fix**: None — low-impact enhancement opportunity for a possible later
  change, not required here.
- **Decision**: SKIPPED

### F3 — Scope boundary (`error.tsx` doesn't cover the root layout) is correct, just worth naming

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Architecture
- **Location**: `src/app/error.tsx`
- **Detail**: `error.tsx` only wraps `page.js`/nested `layout.js` errors, not
  the root layout itself — `global-error.tsx` would be needed for that. The
  plan correctly didn't ask for it; confirming this isn't an oversight.
- **Fix**: None needed.
- **Decision**: SKIPPED
