# Confirm per-run history scope is forward-only Implementation Plan

## Overview

Fix the one real bug `research.md` found while verifying that per-run
history's forward-only scope (F-05) is accurately reflected in the UI:
the run-analysis page's "Final genetic diversity" scalar has no guard
against a null `history` field and silently shows `0.000` for a
history-less run — indistinguishable from a genuinely zero-diversity
run. This closes rollout slice S-37 of `context/foundation/roadmap.md`
(M-9) and formally resolves Open Roadmap Question #4.

## Current State Analysis

- `src/app/runs/[runId]/page.tsx:79` destructures `history` directly
  from the query result (`getRunAnalysis`). Every other section on the
  page that depends on history-derived data guards on `history`'s
  truthiness directly — not on the derived value itself — and renders
  an accurate, specific message when it's null: the population chart
  (`:148-180`, via `populationSamples = history?.populationCountSamples`),
  the genetic-diversity chart (`:184-202`, "No genetic-diversity data
  recorded for this run."), the phase-tally list (`:204-226`, `history
  ? ... : ...`, "No phase data recorded for this run."), and the
  completed-cycles list (`:228-241`, "No completed crash→recovery
  cycles in this run.").
- The "Final genetic diversity" section (`:243-246`) is the sole
  exception: `<p>{finalGeneticDiversity.toFixed(3)}</p>` with no
  conditional at all. `finalGeneticDiversity` comes from the backend
  (`src/server/api/routers/simulation.ts:857-859`,
  `history ? computeGeneticDiversity(...) : 0`) — a deliberate null-safe
  default on the backend side, but one that's indistinguishable from a
  real `0` value once it reaches this unguarded render.
- `history` is already in scope at this point in the component (same
  destructuring as every sibling guard uses) — no new prop, query, or
  data plumbing is needed; this is a pure JSX conditional, matching the
  exact shape already used three times on the same page.
- Real DB rows confirmed by research to exercise this path today
  (`status='stopped'`, `history IS NULL`): ids 41, 42, 73, 74, 75, 12893.

### Key Discoveries:

- No existing message on this page is reused verbatim for two different
  sections — each guard has its own specific wording. The diversity
  *chart*'s existing message ("No genetic-diversity data recorded for
  this run.") describes the time-series being empty; the *scalar*
  stat's message should be distinct so a user doesn't see the identical
  sentence twice for two different things on one page.

## Desired End State

The "Final genetic diversity" section shows an accurate "no data"
message instead of `0.000` when `history` is null, matching the page's
existing guard pattern exactly. Open Roadmap Question #4 is marked
resolved (not just "tracked") in `context/foundation/roadmap.md`, and
roadmap slice S-37's Status is `done`. Verify by: loading
`/runs/41` (or any of the other confirmed null-history ids) in the
running app and confirming the Final genetic diversity section shows
the new message, not `0.000`; loading a run that DOES have history and
confirming it still shows the real numeric value unaffected.

## What We're NOT Doing

- Not changing `getRunAnalysis`'s backend default (`finalGeneticDiversity: 0`
  when history is null) — the backend's null-safe-default pattern is
  correct and intentional for every OTHER consumer of this field (e.g.
  any future caller that needs a safe numeric default); the fix belongs
  at the one render site that fails to check for the null case, not at
  the API contract.
- Not touching any other section of this page — population chart,
  genetic-diversity chart, phase-tally, completed-cycles, and run-
  suggestion all already handle the null-history case correctly and are
  left exactly as-is.
- Not adding a backfill migration or any mechanism to populate `history`
  for old rows — research confirmed this is the intentional, by-design
  forward-only behavior (`drizzle/0004_colorful_slyde.sql`'s bare `ADD
  COLUMN` with no backfill `UPDATE`), and that's the resolution being
  formally closed, not reversed.
- Not touching the dashboard, run-comparison, leaderboard, or export
  surfaces — research confirmed none of them need a null-history guard
  (dashboard/leaderboard never read `history`; comparison doesn't read
  it either; export already emits an accurate `null`/omitted value).

## Implementation Approach

A single phase: add the guard, verify manually against both a real
null-history run and a real history-present run, then close out the
roadmap question and slice.

## Phase 1: Guard fix + manual verification + roadmap closeout

### Overview

Add the missing null-history guard to the Final genetic diversity
section, verify against real data, and formally close Open Roadmap
Question #4 and roadmap slice S-37.

### Changes Required:

#### 1. Add the null-history guard

**File**: `src/app/runs/[runId]/page.tsx`

**Intent**: Show an accurate "no data" message instead of a misleading
`0.000` when a run has no recorded history, matching the exact
conditional-render pattern every sibling section on this page already
uses.

**Contract**: Wrap the existing `<p>{finalGeneticDiversity.toFixed(3)}</p>`
(`:245`) in a `history ? ... : ...` conditional (same shape as the
phase-tally section, `:206-225`), with the else-branch message "No
final genetic-diversity value recorded for this run." — distinct
wording from the diversity chart's existing message (`:200`) so the two
sections never show identical text for two different things on the
same page.

#### 2. Close Open Roadmap Question #4

**File**: `context/foundation/roadmap.md`

**Intent**: Mark the question formally resolved now that the fix has
landed, rather than leaving it as "tracked for formal closure."

**Contract**: Edit entry #4 under `## Open Roadmap Questions` to state
it's resolved (the forward-only behavior is confirmed safe, and the one
UI gap research found is now fixed), removing the "tracked for formal
closure via..." framing.

#### 3. Mark roadmap slice S-37 complete

**File**: `context/foundation/roadmap.md`

**Intent**: Flip S-37's Status to `done` in both `## At a glance` and
its own `### S-37:` body block, now that the fix is implemented and
verified.

**Contract**: Edit the `| S-37 | ... |` row's Status cell and the
`### S-37: Confirm per-run history scope is forward-only` block's
`- **Status:**` line, both to `done`.

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `npm run typecheck`
- Lint passes: `npm run check`
- Full suite still passes: `npm test`

#### Manual Verification:

- Load `/runs/41` (or 42/73/74/75/12893 — confirmed null-history runs)
  in the running app; confirm the "Final genetic diversity" section
  shows "No final genetic-diversity value recorded for this run.",
  not `0.000`.
- Load a run that has recorded history; confirm the section still
  shows the real numeric value, unaffected by the guard.

---

## Testing Strategy

### Unit Tests:

- None — this is a pure JSX conditional on an already-fetched field,
  not new business logic; no new unit-testable function is introduced.

### Integration Tests:

- None — `getRunAnalysis`'s existing null-history handling is already
  covered by its own tests (confirmed stable, unmodified by this plan).

### Manual Testing Steps:

1. Confirm the fix against both a null-history and a history-present
   run, per Phase 1's Manual Verification above — this is a UI-only
   change with no automated test added, so manual verification against
   real data is the primary verification.

## References

- Research: `context/changes/confirm-run-history-retroactive-scope/research.md`
- The one bug: `src/app/runs/[runId]/page.tsx:243-246`
- The sibling pattern being matched: `src/app/runs/[runId]/page.tsx:206-225`
- Roadmap slice definition: `context/foundation/roadmap.md`, S-37 and Open Roadmap Question #4

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Guard fix + manual verification + roadmap closeout

#### Automated

- [ ] 1.1 Typecheck passes: `npm run typecheck`
- [ ] 1.2 Lint passes: `npm run check`
- [ ] 1.3 Full suite still passes: `npm test`

#### Manual

- [ ] 1.4 Null-history run (e.g. `/runs/41`) shows the new message, not `0.000`
- [ ] 1.5 History-present run still shows the real numeric value
