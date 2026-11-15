<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Area-aware population insight (5th score factor)

- **Plan**: context/changes/area-aware-population-insight/plan.md
- **Mode**: Deep
- **Date**: 2026-11-15
- **Verdict**: SOUND
- **Findings**: 0 critical, 0 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | PASS |
| Plan Completeness | WARNING |

## Grounding

Paths: 7/7 ✓ (boids.ts, single-run-lifecycle.ts, server-run-registry.ts, simulation.ts, simulation-canvas.tsx, runs/compare/page.tsx, leaderboard/page.tsx — all exist, line counts match plan's claims within a few lines).
Symbols: `computeResourceManagement`, `computeScore`, `getRunsComparison`, `FACTOR_LABELS`, `listLeaderboard` — all confirmed at claimed locations.
Brief↔plan: consistent (plan-brief.md mirrors the 3-phase structure and 8 resolved decisions).
Codebase verification (sub-agent, 8 riskiest claims): **all 8 CONFIRMED**, no contradictions. The two highest-risk claims both hold against real evidence:
- `simulation-canvas.tsx:304` — `worldSize = { x: xyArea, y: xyArea, z: zDepth }` confirms the plan's `xyArea * xyArea * zDepth` volume formula is correct (square base, not independent x/y).
- `getRunsComparison`'s backward-compat ordering confirmed via git history: `elapsedSeconds` (commit `1e55282`) was added strictly after `foodRatioSamples`/`survivorGenes`/`phaseHistory` (commit `ae1b9ee`) and `populationCountSamples` (commit `1db166f`) — so any row old enough to lack `elapsedSeconds` already has the other three, meaning the new 5th factor really is the only field that can be independently absent.
- Blast radius: `computeScore(` has exactly the 3 production call sites the plan names (plus test-only calls); `listLeaderboard.useQuery()` has exactly one app consumer (`leaderboard/page.tsx`) — adding `scoredWithAreaFactor` to its shape is additive and safe.
- Pattern check: no existing "legacy data marker"/badge component exists in `src/components/ui` or `src/app` — Phase 3's plan to hand-roll a small inline badge (reusing the page's existing `rounded-full` pill styling) is correct; there's nothing to reuse instead.

## Findings

### F1 — No "Desired End State" or "Testing Strategy" section

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Plan structure (compare to `context/archive/2026-11-14-phase-quality-per-cycle-scoring/plan.md`, which has both)
- **Detail**: This plan's Overview section folds the end-state description into prose rather than a labeled "## Desired End State" section, and has no standalone "## Testing Strategy" section — the prior archived plan (S-09) has both as separate headings. Not a defect: every phase's Success Criteria already names concrete test commands, and the Overview paragraph does state the end state clearly. This is a stylistic deviation from the most recent precedent, not a missing capability.
- **Fix**: Optional — no action needed. If consistency with the S-09 template matters, a 2-3 line "## Desired End State" section could be added summarizing the Overview's last two sentences, but the plan is actionable as written.
- **Decision**: PENDING

### F2 — Badge tooltip uses native `title` attribute, not an accessible pattern

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 3, item 2 (`src/app/leaderboard/page.tsx`)
- **Detail**: The plan explicitly chooses a native `title` attribute for the "4-factor score" badge's explanatory text, correctly noting no tooltip library exists in this codebase. Native `title` tooltips are not reliably exposed to screen readers and don't appear on touch devices — a minor accessibility gap for a small, non-blocking decorative marker.
- **Fix**: Optional — if this matters, the badge's visible text itself (not just the tooltip) should be self-explanatory without needing the hover ("4-factor score" already is, on its own). No code change required unless the user wants stronger accessibility guarantees for this one marker.
- **Decision**: PENDING

## Notes

No CRITICAL or WARNING findings. The plan's own "What We're NOT Doing" section correctly anticipates and forecloses the most likely scope-creep directions (retroactive rescoring, a new DB column, touching `parameter-suggestion.ts`/`run-optimization-suggestion.ts`, a dedicated formula-version page). Progress↔Phase consistency is mechanically correct: 3 phase blocks, each with matching `### Phase N:` Progress subsections, and every Success Criteria bullet has a matching numbered Progress item (7+2, 4+2, 4+2 — all accounted for). No `docs/reference/contract-surfaces.md` exists in this repo, so that check was skipped.
