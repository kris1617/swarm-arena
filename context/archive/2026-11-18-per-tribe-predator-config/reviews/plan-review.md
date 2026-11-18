<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Per-tribe predator config Implementation Plan

- **Plan**: context/changes/per-tribe-predator-config/plan.md
- **Mode**: Deep
- **Date**: 2026-11-18
- **Verdict**: REVISE → SOUND (after fixes)
- **Findings**: 1 critical, 2 warnings, 1 observation — all FIXED

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | FAIL |
| Plan Completeness | WARNING |

## Grounding

10/10 paths ✓, symbols ✓ (reproducePopulation gate, LiveAdjustableParams Pick<>, updateTribeConfigs/updatePredatorTribeConfigs confirmed), brief↔plan ✓. No `docs/reference/contract-surfaces.md` in this repo — skipped.

## Findings

### F1 — Phase 2 omits the design-level fix the sweep-corpus scripts need

- **Severity**: ❌ CRITICAL
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Blind Spots
- **Location**: Phase 2 (and its "What We're NOT Doing" / "Migration Notes" sections)
- **Detail**: `scripts/corpus/sweep-matrix.ts` builds its entire parameter-sweep corpus generator around `crossbreedingEnabled` as one of 3 top-level sweep axes (`separationWeight × foodRegenRate × crossbreedingEnabled`, a 4×3×2 grid). `scripts/corpus/harness.ts`'s `StartCorpusRunParams` inherits the field straight from `ServerRunParams`, and `scripts/corpus/generate-sweep.ts` reads/writes it directly (including a CSV header). Phase 2 deletes `crossbreedingEnabled` from `ServerRunParams` with no corresponding decision about what the sweep's third axis becomes. This isn't a mechanical fixture edit like the other ~10 missing files below — the sweep's whole design assumes a single global scalar to vary, which no longer exists. Separately, `context/fixtures/parameter-sweep-corpus/index.csv` is a committed data file with literal `crossbreedingEnabled` values per row that the plan's "What We're NOT Doing" section never names (it only discusses the unrelated `.json.gz`/`corpus-fixture.test.ts` path, which — contrary to the plan's premise — does NOT contain this field at all; `params` there is reconstructed from `sweep-matrix.ts` at test time, not read from committed JSON).
- **Fix A ⭐ Recommended**: Freeze the sweep corpus; stop sweeping this axis
  - Strength: The sweep corpus and its CSV are historical, already-generated artifacts, not user-facing product code — freezing them (mark `index.csv`/the `.json.gz` files as a frozen historical corpus, reduce `sweep-matrix.ts`'s axes to 2, drop the field from `StartCorpusRunParams`/`generate-sweep.ts`) matches the "no cut line" decision's actual intent (ship the product feature) without inventing a new per-tribe-scoped sweep design nobody asked for.
  - Tradeoff: The corpus can no longer be regenerated to add new rows without a follow-up decision on what, if anything, replaces the third axis.
  - Confidence: HIGH — this is dev tooling with no production dependents; freezing it is low-risk.
  - Blind spot: Haven't checked whether any other script or test depends on the sweep corpus being regenerable on demand.
- **Fix B**: Redesign the sweep axis onto one tribe's per-tribe `crossbreedingEnabled`
  - Strength: Preserves the sweep's existing 3-axis shape and its ability to explore the new mechanic.
  - Tradeoff: Real design work on tooling this change wasn't asked to extend — picks which tribe's flag to sweep, and a 2-tribe-minimum scenario to make it meaningful.
  - Confidence: MEDIUM — mechanically straightforward, but scope creep into deciding a new corpus-design question.
  - Blind spot: Whether a 2-value per-tribe sweep on one tribe is actually a meaningful variable for whatever this corpus is used to validate downstream.
- **Decision**: FIXED (Fix B — added Phase 2 #6a redesigning `sweep-matrix.ts`/`harness.ts`/`generate-sweep.ts`/`perf-baseline.ts` around `tribeConfigs[0].crossbreedingEnabled` with a ≥2-tribe scenario)

### F2 — Phase 2's file list is missing ~10 files across production code and tests

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2, Changes Required #2–#7
- **Detail**: Beyond F1's sweep-corpus design gap, these files reference `crossbreedingEnabled` and are not in the plan's file list, but only need mechanical edits (Phase 2's own gates — `npm run typecheck`/`npm test` — would catch each as a compile/test failure, so nothing here is silently missable, but naming them up front avoids mid-phase rediscovery):
  - `src/app/reference/parameters/page.tsx` — `PARAMETER_DESCRIPTIONS`/`PARAMETER_LABELS` (`Record<TopLevelRangedParameterName, string>`) and a `.filter(name !== "crossbreedingEnabled")` — the Record literals break once the union member is removed.
  - `src/app/admin/settings/_components/admin-settings-form.tsx` — same filter pattern, same break.
  - `src/server/simulation/parameter-suggestion.ts` — `PARAMETER_LABELS` Record literal, same break (the plan's Phase 2 #6 only names this file's *test*, not the production file itself).
  - `src/server/simulation/server-run-registry.test.ts` — a dedicated "live-crossbreeding-toggle" test block (not in the plan's list at all) asserting `liveParams.crossbreedingEnabled` and a `ParameterChangeEntry` keyed on it.
  - `scripts/corpus/harness.test.ts`, `scripts/corpus/generate-sweep.smoke.test.ts` — both run under the default `npm test` (confirmed via `vitest.config.ts`), both reference the field, downstream of F1's sweep-matrix decision.
  - `scripts/perf-baseline.ts` — a literal `crossbreedingEnabled: true` fixture value.
- **Fix**: Add these 7 files to Phase 2's file list (the sweep-related 2 test files resolve naturally once F1 is decided).
- **Decision**: FIXED (added as Phase 2 #6a/#6b and extended the fixture-updates file list)

### F3 — Two independent "field union" surfaces are kept in sync by hand

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 2 #3 (server-run-registry.ts) and #2 (simulation.ts)
- **Detail**: `ParameterChangeEntry.field`'s `keyof LiveAdjustableParams`-derived union is one surface; `simulation.ts:641-647`'s separate runtime `z.enum([...RANGED_PARAMETER_NAMES, "tribeConfigs", "predatorTribeConfigs"])` validation for `parameterChanges[].field` is a second, independently-maintained surface. Both currently list `crossbreedingEnabled`; the plan's Phase 2 #6 does cover removing it from `RANGED_PARAMETER_NAMES`, so this stays consistent as written — but the two surfaces aren't type-linked, so it's worth an explicit cross-check at implementation time rather than relying on one edit to imply the other.
- **Fix**: Add a one-line note to Phase 2 #2's Contract calling out both surfaces explicitly, so the implementer verifies both rather than assuming the type system catches a mismatch.
- **Decision**: FIXED (added to Phase 2 #2's Contract)

### F4 — Committed CSV corpus referenced only implicitly

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: "What We're NOT Doing"
- **Detail**: `context/fixtures/parameter-sweep-corpus/index.csv` is a real committed artifact with a `crossbreedingEnabled` column; the plan's "What We're NOT Doing" names a different, unrelated fixture path (the `.json.gz`/`corpus-fixture.test.ts` path, which doesn't actually contain this field). Once F1 is resolved, this CSV becomes either frozen-as-is or needs its header/column dropped — worth naming explicitly rather than leaving it implied by F1's fix.
- **Fix**: Add one sentence to "What We're NOT Doing" naming `index.csv` explicitly and stating its fate (frozen as historical artifact, under Fix A).
- **Decision**: FIXED (added to "What We're NOT Doing" — already-committed data stays frozen regardless of F1's Fix B; only future corpus generation uses the redesigned axis)
