# Wall-clock-aware optimization guardrail Implementation Plan

## Overview

Close rollout Phase 10 of `context/foundation/test-plan.md` (Risk #7) by
documenting a manual-review Quality Gate: any claimed simulation-engine
performance improvement must pass both the existing structural guard
(`pipeline-perf.test.ts`) and show a wall-clock comparison against Phase
8's tracked baseline (`npm run perf:baseline` / `context/foundation/perf-baseline.json`)
before merging. Also records a `lessons.md` entry naming the confirmed
gap the `spatial-hash-performance-optimization` incident exposed. This
is pure documentation — no code changes, no new tests.

## Current State Analysis

- `pipeline-perf.test.ts`'s structural guard (Math.hypot call-count
  ratio) is already enforced by the existing CI `test` job
  (`.github/workflows/deploy.yml`, confirmed in `test-plan.md` §5's
  "unit + integration" row) — it is not new, and this phase does not
  touch it.
- `perf-baseline.json` has exactly 1 historical entry (research.md §3).
  Its own within-run noise (0.3%–23.5% of mean across the 54-config grid,
  averaging 3.8%, research.md §4) rules out a safe automated hard-fail
  threshold today — confirmed via direct computation against the
  committed data, not assumed.
- `test-plan.md` §5's own table already marks several rows
  `not wired, not planned` with a `—` Required column, and separately
  shows the convention for a gate that's required once a specific
  rollout phase lands (`"Required for §3 Phase <N>"` in the section's own
  prose) — this phase's new row follows that exact pattern: `required
  after §3 Phase 10`, `Where: manual, pre-merge` (no CI wiring, since
  Phase 8's benchmark is explicitly `benchmark (non-CI-gating)`).
- No `lessons.md` entry currently references the spatial-hash incident or
  wall-clock/structural-guard blindness (confirmed via grep across the
  whole file) — this is a genuine gap, not a duplicate of existing
  coverage.

### Key Discoveries:

- The incident this risk is about is fully documented and closed
  (`archive/2026-11-15-spatial-hash-performance-optimization/plan.md`'s
  Overview: the grid optimization measurably slowed `stepBoids`' boid-boid
  loop, kept anyway for consistency) — this phase's job is purely to make
  the *process gap* that allowed it durable and visible, not to revisit
  that decision.
- `test-plan.md` §6's cookbook entries follow a fixed
  Location/Pattern/Reference/Run-command shape for *test* patterns; a
  manual-review checklist gate is process documentation, not a test
  pattern, so it belongs in §5 (Quality Gates), not a new §6 entry — no
  §6 cookbook entry is added by this phase.

## Desired End State

`test-plan.md` §5 has a new gate row requiring both the structural guard
and a wall-clock comparison for any claimed simulation-engine perf
change, marked `required after §3 Phase 10`. `lessons.md` has a new entry
naming the confirmed structural-guard blindness pattern, citing the real
incident. §3 Phase 10's row is `complete`. Verify by: reading §5's new
row and the new lessons.md entry, confirming both cite the real incident
and research.md's noise data accurately.

## What We're NOT Doing

- Not building an automated wall-clock regression test — research.md §5
  confirmed the current single-data-point/high-variance state doesn't
  support a safe threshold; this is a documented, deliberate deferral,
  not an oversight.
- Not adding a `--compare` flag to `scripts/perf-baseline-report.ts` —
  explicitly declined; the manual-review step uses the already-committed
  `perf-baseline.json`/`capacity-limits.md` artifacts directly.
- Not weakening, rewriting, or extending `pipeline-perf.test.ts` — it
  stays exactly as-is; this phase adds a second, independent
  requirement, not a replacement.
- Not retroactively reopening the `spatial-hash-performance-optimization`
  decision — that change's tradeoff (kept despite the regression, for
  consistency) stands; this phase only ensures a *future* instance of
  the same pattern gets caught before merge, not after.

## Implementation Approach

A single phase: add the Quality Gate row, add the lessons.md entry, mark
the rollout phase complete. No code, no tests — the entire change is two
documentation edits plus a status flip.

## Phase 1: Quality Gate + lessons entry + Phase 10 closeout

### Overview

Document the manual-review requirement as a formal Quality Gate, record
the recurring pattern in `lessons.md`, and close out rollout Phase 10.

### Changes Required:

#### 1. New Quality Gate row

**File**: `context/foundation/test-plan.md`

**Intent**: Make the "prove it in both dimensions" requirement a durable,
discoverable gate rather than tribal knowledge — a future session
reviewing a simulation-engine perf change checks §5 and finds the
requirement named explicitly.

**Contract**: New row in §5's gate table: `| wall-clock comparison for
simulation-engine perf changes | manual, pre-merge (no CI wiring — see
§3 Phase 8's `benchmark (non-CI-gating)` classification) | required
after §3 Phase 10 | a change that passes `pipeline-perf.test.ts`'s
structural guard while regressing real wall-clock cost (confirmed
incident: `archive/2026-11-15-spatial-hash-performance-optimization/plan.md`)
|`. The gate's own row text names both required checks explicitly — the
structural guard (`pipeline-perf.test.ts`, already covered by the
existing "unit + integration" row) and the wall-clock comparison (run
`npm run perf:baseline` or a representative config subset, compare
against the latest `context/foundation/perf-baseline.json` entry) — so a
reader of this one row gets the complete requirement without
cross-referencing.

#### 2. Lessons entry

**File**: `context/foundation/lessons.md`

**Intent**: Record the confirmed, recurring pattern — a structural
complexity guard (call-count/big-O) can pass while a specific function's
real wall-clock cost regresses, when the guard's own test scenario
happens to sit in a region where the "optimization" doesn't actually
narrow anything — so `/10x-plan`/`/10x-impl-review` recognize this shape
on a future simulation-engine change.

**Contract**: New H2 section following the file's existing format
(Context / Problem / Rule / Applies to), citing
`archive/2026-11-15-spatial-hash-performance-optimization/plan.md`'s
Overview as the concrete incident and `pipeline-perf.test.ts`'s own
in-file comment (acknowledging the post-optimization ratio stays in-band
specifically because that test's scenario doesn't exercise the
regression) as the mechanism.

#### 3. Mark rollout Phase 10 complete

**File**: `context/foundation/test-plan.md`

**Intent**: Flip Phase 10's §3 Status cell to `complete` once this plan's
Progress is fully `[x]`.

**Contract**: Edit the `| 10 | Wall-clock-aware optimization guardrail |
... |` row's Status cell. Also bump the file's "Last updated" header note.

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `npm run typecheck` (sanity-check only — no code
  changed, but confirms no stray syntax issue in edited markdown-adjacent
  files)
- Lint passes: `npm run check`

#### Manual Verification:

- Read §5's new gate row and confirm it names both required checks and
  cites the real incident accurately.
- Read the new `lessons.md` entry and confirm it accurately reflects
  research.md's findings (the guard measures shape not speed; the
  incident is real and already shipped/kept).

---

## Testing Strategy

### Unit Tests:

- None — this phase is documentation only.

### Integration Tests:

- None.

### Manual Testing Steps:

1. Read the new §5 row and `lessons.md` entry for accuracy against
   research.md and the cited archived plan.

## References

- Research: `context/changes/testing-wallclock-optimization-guardrail/research.md`
- The confirmed incident: `archive/2026-11-15-spatial-hash-performance-optimization/plan.md`
- The structural guard: `src/server/simulation/pipeline-perf.test.ts`
- The wall-clock baseline: `context/archive/2026-11-17-testing-perf-baseline/`, `context/foundation/perf-baseline.json`
- Rollout phase definition: `context/foundation/test-plan.md` §3, Phase 10

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Quality Gate + lessons entry + Phase 10 closeout

#### Automated

- [x] 1.1 Typecheck passes: `npm run typecheck`
- [x] 1.2 Lint passes: `npm run check`

#### Manual

- [x] 1.3 §5 new gate row names both required checks and cites the real incident accurately
- [x] 1.4 `lessons.md` entry accurately reflects research.md's findings
