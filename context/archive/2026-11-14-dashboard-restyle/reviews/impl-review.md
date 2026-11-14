<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Restyle the post-login dashboard onto the F-06 design-system contract

- **Plan**: context/changes/dashboard-restyle/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3
- **Date**: 2026-11-14
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning (fixed), 1 observation (dismissed)

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

### F1 — No error-state branch for the three dashboard queries

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots (plan's own Charge reasoning)
- **Location**: src/app/dashboard/page.tsx:54-60 (before fix)
- **Detail**: The plan's Phase 3 explicitly reasoned the "error" state of the 7-state matrix was N/A ("this view has no form submission or error-producing action"). Agent 2's review correctly identified that reasoning as incomplete: the three tRPC queries *can* fail, and with no `isError` check, a failed fetch would render the "You haven't started any simulations yet." empty-state message instead of signaling a failure — misleading during an actual outage. Not a regression introduced by this change (the gap predates it), but real and user-facing.
- **Fix**: Added an `isError` flag (`runningQuery.isError || savedQuery.isError || completedQuery.isError`) and a distinct error-state render branch, checked before `isEmpty` — same pattern as the `isLoading` branch this change already introduced.
- **Decision**: FIXED (commit c56bca1)

### F2 — Possible missing `<main>` landmark after the root-element change

- **Severity**: OBSERVATION
- **Impact**: LOW — no action needed, verified false positive
- **Dimension**: Architecture
- **Location**: src/app/dashboard/page.tsx:67 (root `<div>`, formerly `<main>`)
- **Detail**: Agent 2 flagged, without checking `layout.tsx`/`AppShell`, that changing the page root from `<main>` to `<div>` might drop the page's only landmark if nothing else provides one. This was already directly verified false during this change's own manual testing: the browser accessibility snapshot (captured mid-implementation, Phase 2) shows exactly one `main` element on the authenticated dashboard, owned by `AppShell`'s `SidebarInset` (`src/components/ui/sidebar.tsx:303-312`), which is the entire point of Charge 3's fix.
- **Fix**: None needed.
- **Decision**: DISMISSED (verified correct via direct browser accessibility-tree inspection during implementation; agent's concern did not account for `AppShell`'s own `<main>`)

## Success Criteria Verification

**Automated** (re-run after F1's fix): `npm run typecheck` PASS, `npm run check` PASS (exit 0; one pre-existing vendor warning in generated `sidebar.tsx`, unrelated), `npm test` PASS (209/209), hardcoded-value scan on `dashboard/page.tsx` returns zero hits.

**Manual**: all four research charges confirmed fixed by direct browser testing (Playwright) during implementation — visible focus ring on previously focus-blind actions (screenshotted), themed `Checkbox` rendering correctly in both unchecked and checked states against a real completed run created through the app's own flow, exactly one `main` landmark in the accessibility tree, and the loading skeleton captured via an artificially delayed tRPC route (screenshotted) rather than merely asserted from code. Keyboard-tab focus-visible was directly screenshotted for one of the five converted links ("Start a simulation"); the other four were verified structurally (identical `Button asChild` pattern, confirmed by Agent 1's drift check) rather than individually screenshotted.

## Notes

- No scope creep: `git show --stat` across all 5 commits (cdddbee, 2cfbd05, 862e71c, 04d6a6c, c56bca1) touches only `checkbox.tsx`, `dashboard/page.tsx`, and change-folder/roadmap docs — `simulation/page.tsx`, `runs/*`, tRPC routers, and `globals.css` are all untouched, exactly as the plan's "What We're NOT Doing" specified.
- The nested-`<main>` and link-as-button patterns this change fixed are confirmed (by this change's own research) to recur in `simulation/page.tsx` and `runs/*` pages — flagged for S-17/S-18 to pick up, not fixed here.
