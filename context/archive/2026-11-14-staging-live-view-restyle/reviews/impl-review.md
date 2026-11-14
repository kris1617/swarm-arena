<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Restyle the simulation staging form and live view onto the F-06 design-system contract

- **Plan**: context/changes/staging-live-view-restyle/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3
- **Date**: 2026-11-14
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 2 observations

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

### F1 — Skeleton and ServerRunViewer can render simultaneously

- **Severity**: OBSERVATION
- **Impact**: LOW — no action needed
- **Dimension**: Safety & Quality
- **Location**: src/app/simulation/page.tsx:228-238
- **Detail**: The new loading skeleton and the `ServerRunViewer` live-view component are independent sibling render branches with no mutual exclusion. If a server run was just started (setting `viewingRunId`) while one of the two run-list queries is still pending on a slow connection, both the skeleton and the live canvas render stacked vertically for a moment — not a bug, just a possibly odd double-loading-indicator instant.
- **Fix**: None required — acceptable for a polling-list skeleton. Noted as a conscious accept, not a gap to close.
- **Decision**: ACCEPTED (no code change; documented tradeoff)

### F2 — NumberField introduces a new "labeled field" composite shape not yet established elsewhere in ui/

- **Severity**: OBSERVATION
- **Impact**: LOW — no action needed
- **Dimension**: Pattern Consistency
- **Location**: src/components/ui/number-field.tsx
- **Detail**: Unlike `switch.tsx` (a bare primitive wrapper where the caller composes the label), `NumberField` bundles `<label>` + `<Input>` into one component. This is a deliberate, reasonable deduplication choice for 12 near-identical blocks, not a defect — but it establishes a new component shape ("primitive + its own label") that doesn't exist elsewhere in `src/components/ui/` yet.
- **Fix**: None required now. Worth naming explicitly if a third labeled-field type appears, so the pattern doesn't fork into two incompatible shapes.
- **Decision**: ACCEPTED (no code change; precedent noted for future reference)

## Success Criteria Verification

**Automated** (re-run during implementation, all 3 phases): `npm run typecheck` PASS, `npm run check` PASS (exit 0; one pre-existing vendor warning in generated `sidebar.tsx`, unrelated), `npm test` PASS (209/209), hardcoded-value scan on `simulation/page.tsx` returns zero hits.

**Manual**: confirmed via browser testing (Playwright) during implementation — all (13, see note below) numeric fields render and update correctly through `NumberField` with byte-identical bounds to the original blocks (confirmed by Agent 1's drift check against the commit diff); exactly one `main` landmark; focus-visible ring intact on a `NumberField` instance (screenshotted); loading skeleton captured via an artificially delayed tRPC route (screenshotted, desktop and mobile); the four existing mutation error-render paths (`text-destructive`) confirmed unchanged by the diff, though not visually re-triggered this round (code-path verification only, not a live screenshot of an actual error — narrower than the dashboard-restyle review's error-state check).

## Notes

- **Field-count correction**: both `research.md` and `plan.md` say "12" numeric fields/blocks in their prose, but Agent 1's drift check correctly points out the named list actually enumerates 13 once "separation/alignment/cohesion weight" is unpacked into three separate fields. The implementation ported all 13 correctly — this is a miscount in the planning docs' prose, not a gap in the code. No fix needed to the shipped code; left as a documentation nit in the archived plan rather than editing a plan already fully executed.
- No scope creep: `buildStartInput`'s clamping logic, both queries' `refetchInterval: 2000`, the save/resume/start mutations, the suggestion card, and the "Crossbreeding enabled" `Switch` are all confirmed unchanged by the diff.
- The nested-`<main>` pattern this change fixed (shared with dashboard-restyle) is confirmed, per this change's own research, to still recur in `runs/[runId]/page.tsx` and `runs/compare/page.tsx` — flagged for S-18 to pick up, not fixed here.
