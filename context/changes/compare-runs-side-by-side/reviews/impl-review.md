<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Compare completed runs side by side Implementation Plan

- **Plan**: context/changes/compare-runs-side-by-side/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3
- **Date**: 2026-11-14
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 5 observations

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

### F1 — Breakdown guard's code snippet vs. prose (plan artifact, not implementation)

- **Severity**: 👁️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `plan.md` Phase 1 Contract snippet vs. `src/server/api/routers/simulation.ts:624-628`
- **Detail**: The plan's literal code-block Contract only showed `Array.isArray(phaseHistory) && typeof elapsedSeconds === "number"`, omitting `survivorGenes` — but the plan's own prose immediately below it explicitly says the guard "mirrors `getRunAnalysis`'s (`Array.isArray` on `phaseHistory`/`survivorGenes`), plus a `typeof history.elapsedSeconds === "number"` check." The implementation matches the prose (the authoritative statement of intent), not the abbreviated snippet. Confirmed: `Array.isArray(rawHistory.phaseHistory) && Array.isArray(rawHistory.survivorGenes) && typeof rawHistory.elapsedSeconds === "number"`.
- **Fix**: None needed — no action required. The implementation is correct; this is a documented strengthening, not a deviation.
- **Decision**: SKIPPED (no action warranted)

### F2 — N+1 query in `getRunsComparison`

- **Severity**: 👁️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/server/api/routers/simulation.ts:594-655`
- **Detail**: A sequential `findFirst` per `runId` inside the loop, up to 4 separate queries instead of one `IN (...)` query. Bounded by the zod `.min(2).max(4)` cap and required by the per-row independent-failure semantics (one bad ID can't fail the batch) — not a real performance problem at this scale.
- **Fix**: None needed — no action required.
- **Decision**: SKIPPED (no action warranted — bounded and intentional)

### F3 — `foodRatioSamples` remains unguarded in both `getRunAnalysis` and `getRunsComparison`

- **Severity**: 👁️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/server/api/routers/simulation.ts:624-628, 536-540`
- **Detail**: Both guards check `phaseHistory`/`survivorGenes`/(`elapsedSeconds` in the new one) but pass `rawHistory.foodRatioSamples` into `computeResourceManagement` unchecked. Pre-existing behavior from before this change (not introduced here) — a malformed `foodRatioSamples` on a legacy row could still throw. Out of this change's scope since it predates it.
- **Fix**: None needed for this change — no action required; worth a follow-up if a future change touches this guard again.
- **Decision**: SKIPPED (pre-existing, out of scope for this change)

### F4 — "not yours" vs "not found" distinguishability

- **Severity**: 👁️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/app/runs/compare/page.tsx:26-30`
- **Detail**: The comparison page's `ERROR_LABELS` distinguishes "not yours" from "not found," surfacing the same existence-disclosure posture that already exists upstream (`getRunAnalysis`/`stop`/`savePause`/`resume` all distinguish `FORBIDDEN` from `BAD_REQUEST`). Not a new concern introduced by this change — if considered a problem, it's router-wide and predates this diff.
- **Fix**: None needed for this change — no action required.
- **Decision**: SKIPPED (pre-existing posture, not introduced by this change)

### F5 — Test coverage for the new `elapsedSeconds` field and `getRunsComparison`

- **Severity**: 👁️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: `server-run-registry.test.ts`, `simulation.test.ts`
- **Detail**: Confirmed adequate coverage: `elapsedSeconds` persistence at both server-owned write sites, plus `getRunsComparison`'s full-breakdown, legacy-null-breakdown, malformed-`survivorGenes`-null-breakdown, and zod-boundary (2-4) paths.
- **Fix**: None needed — no action required.
- **Decision**: SKIPPED (coverage confirmed adequate)

## Not flagged as findings (reviewed, found adequate)

- `getRunsComparison` matches `getRunAnalysis`/`stop`/`savePause`/`resume`'s exact ownership-check (`forbidden`) and status-gate (`not-completed`) order, converting throws into per-row markers as documented instead of failing the whole batch.
- Dashboard checkbox: correct controlled pattern (`checked`/`onChange`/`disabled`), accessible `aria-label` present.
- `/runs/compare/page.tsx` matches `/runs/[runId]/page.tsx`'s conventions (Tailwind shell classes, `isPending`/`isError` loading-state shape, Recharts import style) while correctly using `useSearchParams()` instead of `useParams()` since this route has no dynamic segment.
- All "What We're NOT Doing" constraints held: no backfill, no mismatched-parameter warning, hard 2-4 cap enforced at both the dashboard button and the zod boundary, only Recharts `BarChart` used (no new library), `/runs/[runId]` and the dashboard's Running/Saved sections untouched.
- Automated success criteria: `npm run typecheck`, `npm run check`, `npm test` (184/184) all passed at every phase boundary.
- Manual success criteria: all verified live via dev server + Playwright with real fixture data across full-history, legacy (no `elapsedSeconds`), historyless, not-found, forbidden, and not-completed cases, plus the full dashboard round-trip — not rubber-stamped.
