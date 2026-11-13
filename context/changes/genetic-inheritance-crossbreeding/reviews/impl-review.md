<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Genetic inheritance and inter-flock crossbreeding (S-03)

- **Plan**: context/changes/genetic-inheritance-crossbreeding/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3, 4, 5, 6
- **Date**: 2026-11-13
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 1 high-impact warning (deploy-blocking), 1 warning, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Grounding

Two parallel sub-agents reviewed all 6 phases: zero drift across any planned change (every "Changes Required" item verified MATCH against actual code), both manually-fixed bugs from commit 817d249 confirmed genuinely present in the diff (not just claimed), and every "What We're NOT Doing" boundary respected. All automated success criteria re-verified directly: `npm run typecheck` clean, `npm run check` (Biome) clean, `npm test` 130/130 passing, `npm run build` succeeds.

## Findings

### F1 — Migration 0002 will break the next real production deploy

- **Severity**: ⚠️ WARNING
- **Impact**: 🔬 HIGH — architectural/operational stakes; this blocks safely shipping S-03 to the live VPS, not just a local dev nit
- **Dimension**: Safety & Quality (data safety)
- **Location**: `drizzle/0002_wonderful_micromacro.sql`; `context/deployment/deploy-plan.md:13`

**Detail**: The migration adds 5 `NOT NULL` columns (`flockCount`, `crossbreedingEnabled`, `energyThreshold`, `mutationChance`, `mutationMagnitude`) to `simulation_run` with no `DEFAULT`. Verified directly: `ALTER TABLE ... ADD COLUMN x NOT NULL` with no default fails outright against any table with existing rows (`Cannot add a NOT NULL column with default value NULL`).

This went unnoticed locally because Phase 6 used `db:push` against a dev `db.sqlite` it could freely delete — not because the migration itself is safe. I checked this project's actual production procedure: `deploy-plan.md:13` documents that production schema changes are pushed via **`drizzle-kit push`, run once via a throwaway container directly against the live `/opt/swarm-arena/data/db.sqlite`** — a manual step, not something the CI/CD pipeline (`.github/workflows/deploy.yml`) runs automatically (its own `db:migrate` step runs against a fresh, ephemeral CI-local file, not the VPS). So this isn't a CI/CD break — it's a **deploy-day break**: the next time this change actually gets pushed to the live database, `drizzle-kit push` will hit the same interactive "need a default value" prompt Phase 6's agent hit locally (confirmed in commit 817d249's own report). Locally the fix was `rm -f db.sqlite` — that is **not an option against real user data** on the production VPS.

**Fix**: Add explicit `DEFAULT` values to the 5 new columns, matching the UI defaults already chosen this phase (`flockCount DEFAULT 2`, `crossbreedingEnabled DEFAULT 1`, `energyThreshold DEFAULT 50`, `mutationChance DEFAULT 0.1`, `mutationMagnitude DEFAULT 0.2`), so `drizzle-kit push` can apply the migration non-interactively against a populated table — existing rows get backfilled with these defaults, new rows always supply real values via `start`'s required zod fields anyway.
  - Strength: Makes the migration artifact genuinely safe to replay against any table state, independent of which tool (`push` or `migrate`) ends up applying it; no production-data judgment call needed on deploy day.
  - Tradeoff: `schema.ts`'s Drizzle column defs would need matching `.default(...)` calls (currently deliberately required-only, per the plan's own design intent that these are real user inputs) — a cosmetic widening of the TS type to `number | undefined` at the schema layer unless the app-level zod/insert path still always supplies a value (it does, via `start`), so this is low-risk but does touch a file already reviewed as PASS.
  - Confidence: HIGH — this is the standard safe pattern for adding NOT NULL columns to a populated table; this exact concern is why `src/server/db/schema.ts`'s other NOT NULL columns were always added at table-creation time, never retrofitted before now.
  - Blind spot: Haven't verified whether the production `db.sqlite` currently has any `simulation_run` rows (if it's actually empty right now, this migration would apply cleanly as-is and the fix is precautionary rather than urgently blocking) — this needs checking before deploying, not before finishing this review.

### F2 — `multi-run-lifecycle.ts`'s mate-scan adds real weight to an already-quadratic per-tick cost

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — bounded by existing caps (FR-018's 500 objects/run, `MAX_PARALLEL_RUNS`=4), not urgent, but worth tracking
- **Dimension**: Safety & Quality (performance)
- **Location**: `src/server/simulation/boids.ts` (`reproducePopulation`, O(n²) mate-scan); `src/server/simulation/multi-run-lifecycle.ts` (`computeMultiRunTick`, runs the full pipeline for every running slot every RAF frame, including backgrounded ones)

**Detail**: `reproducePopulation`'s mate-scan is O(n²), run twice per tick (boids + predators) on top of `stepBoids`'s existing O(n²) neighbor scan. Bounded worst case for one run: ~500² pairwise ops × 2 ≈ 500k comparisons/tick. Multi-run compounds this across up to 4 parallel slots every animation frame (by design — backgrounded runs still tick so they don't stall when viewed) → up to ~2M comparisons/frame on the main thread, worst case. Not unbounded, not a regression in kind, but it is new weight added on top of a pre-existing quadratic design, and the first FR-018-adjacent feature to actually push multiple near-cap populations through reproduction every frame simultaneously.

**Fix**: No code change required now — this is a "watch it" finding, not a defect. If users report frame drops running multiple near-cap parallel simulations, profile `computeMultiRunTick` first; the likely lever is adding an early-exit in `reproducePopulation` once a tick's `populationCap` is already reached (skip the mate-scan entirely rather than scanning and then discarding at the cap check), which only helps the already-capped case, not the general one.

### F3 — Dismissed multi-run slots leak their `populationCapped` flag in page state

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (reliability — minor resource leak)
- **Location**: `src/app/simulation/multi/page.tsx` (`populationCappedByRunId` state, `handleDismiss`)

**Detail**: `populationCappedByRunId` only grows (via `handlePopulationCapped`) and is never pruned when a slot is dismissed via `handleDismiss`/`removeSlot`. Over a long session with many started/stopped/dismissed runs, this `Record` accumulates one boolean per ever-seen `runId` for the lifetime of the page. Asymmetric with `multi-run-lifecycle.ts`'s own `runStates`, which does prune dismissed slots. Low real-world impact (booleans, bounded by session length), but it's a genuine, easily-fixed inconsistency.

**Fix**: In `handleDismiss`, also remove the dismissed `runId`'s entry from `populationCappedByRunId`, mirroring how `removeSlot` already prunes `RunSlotsState`.

## Notes on what was NOT flagged

- Auth/authz unchanged and correct: `start`/`stop` remain `protectedProcedure`, `stop`'s ownership check (`FORBIDDEN` on mismatch) intact, all 5 new zod fields properly bounded (`.min()`/`.max()`/`.positive()`).
- No new N+1 DB queries; the existing count-then-recheck race-safety pattern in `start`/`stop` is unchanged in shape.
- No React ref/state leak in `simulation-canvas.tsx` — each run gets a fresh component instance via `key={activeRun.runId}`.
- Pattern compliance across all new code (comment style, form-field JSX pattern, the shadcn-scaffolded `switch.tsx`, `multi-run-lifecycle.ts`'s pure/immutable contract) — no substantive mismatches found.
