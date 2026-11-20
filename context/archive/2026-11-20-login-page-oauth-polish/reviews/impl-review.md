<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Login page OAuth polish

- **Plan**: context/changes/login-page-oauth-polish/plan.md
- **Scope**: Full plan (single phase)
- **Reviewed phases**: 1
- **Date**: 2026-11-20
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 1 observation

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

### F1 — research.md's Historical Context missed a more directly relevant prior change

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; informational, doesn't require code changes
- **Dimension**: Plan Adherence
- **Location**: context/changes/login-page-oauth-polish/research.md (Historical Context section)
- **Detail**: During this review, `git log` surfaced `context/archive/2026-11-18-google-style-auth-ux/` — a prior change whose own title and Overview literally describe "a polished, Google-style sign-in/sign-out experience" (centered card, GitHub icon, `useFormStatus` pending state, error banner) — i.e., it already established most of the baseline this change (S-53) then modified. Research's Historical Context section only cited the older, less-relevant `branded-login-page` (S-15, 2026-11-14, favicon-only scope) and missed this closer, more applicable precedent. This did not affect correctness: research's "Current State Analysis" read the actual current file contents directly (not from history), so the plan's contract was accurate regardless. The gap is purely in historical framing/completeness, not in what was built.
- **Fix**: None needed for this change's code — the implementation is correct. For future research on files with meaningful history, run a broader `git log --oneline -- <path>` (or search all of `context/archive/` for the touched files) rather than guessing which named prior changes might be relevant, so Historical Context sections don't miss the most applicable precedent.
- **Decision**: FIXED + ACCEPTED-AS-RULE: Historical Context must be grounded in a broad git log search, not a guessed named precedent (research.md's Historical Context updated to cite `google-style-auth-ux`; lesson appended to `context/foundation/lessons.md`)

## Summary

Plan Drift Detection (Agent 1) found all 3 planned items MATCH exactly — the button's variant/width/icon-swap, the card's width change, and the known `<form className="w-full">` adaptation (verified as the only addition beyond the plan's literal contract). Scope discipline confirmed via `git show --stat 6cbcd35`: no other files touched, GitHub remains the sole provider, no change to `signIn()`/`authConfig`/`middleware.ts`.

Safety, Quality & Pattern Compliance (Agent 2) found no CRITICAL or WARNING issues — the server action and `resolveSafeRedirect` call are byte-unchanged, only presentational classes/icon logic were added. Two informational notes: `sign-in-button.tsx` is the first component in this codebase to add a spinner-on-pending indicator (no prior convention existed to diverge from — a legitimate new pattern, not a deviation), and the `outline`/`destructive` variant choices between sign-in and sign-out buttons are both deliberate and context-appropriate.

One OBSERVATION (F1) was found during this review itself: research.md's Historical Context section missed a more directly relevant prior change (`google-style-auth-ux`, 2026-11-18) that had already established the login page's centered-card/icon/pending-state baseline. This doesn't affect correctness — research's current-state analysis read the live file contents directly — but is worth recording as a process note for future research on files with git history.

Success criteria: all automated gates (typecheck, lint, full test suite, hardcoded-value scan) verified green by this review. All manual criteria were performed live during implementation (screenshots, DOM width measurement confirming the button genuinely spans full width, idle-state spinner-absence check, and a redirect regression click-through) with recorded evidence — no rubber-stamped checkboxes. The implementation also caught and fixed a real mismatch during its own manual verification (the form shrink-wrap issue), handled correctly per the implementation-discipline "Minor adaptation" path.
