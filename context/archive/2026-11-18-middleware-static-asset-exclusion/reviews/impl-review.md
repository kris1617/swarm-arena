<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Middleware static-asset exclusion

- **Plan**: context/changes/middleware-static-asset-exclusion/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1
- **Date**: 2026-11-18
- **Verdict**: APPROVED (triaged — both findings FIXED)
- **Findings**: 0 critical, 0 warnings, 2 observations — all FIXED

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — Dot-exclusion also exempts all dotted tRPC paths, undocumented

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/middleware.ts:13
- **Detail**: `.*\..*` matches a dot anywhere in the path, not just the last segment — so every tRPC HTTP call (always dotted, e.g. `/api/trpc/post.hello`) now also skips the Next middleware gate. Verified NOT exploitable: `protectedProcedure` enforces its own 401 independently, and this tRPC traffic previously got redirected to an HTML `/login` page instead of tRPC's own JSON 401 — arguably a latent bug this fix incidentally corrects. But it's undocumented.
- **Fix**: Add a one-line comment on the matcher noting it also exempts tRPC's dotted procedure paths, and tRPC's own auth layer is what actually gates them.
- **Decision**: FIXED

### F2 — Test's lookahead-extraction regex assumes no nested parens

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/middleware.test.ts:12
- **Detail**: `/\(\?!([^)]*)\)/` stops at the first `)` — correct today (no nested parens in the matcher), but would silently extract a truncated alternation if a future matcher alternative itself contained a parenthesized group.
- **Fix**: Add a one-line comment noting the one-level-of-parens assumption.
- **Decision**: FIXED
