# Corpus-generation harness — Plan Brief

> Full plan: `context/changes/corpus-generation-harness/plan.md`

## What & Why

A reusable library that drives one server-owned simulation run end-to-end through the real app's execution path (not a shortcut around the engine), under a simulated-duration cap up to 60 minutes, and returns its persisted analysis payload. This is the foundation a later slice (S-33) calls ~20 times, batched up to 4-wide, to build the full parameter-sweep corpus M-8 needs.

## Starting Point

The codebase already has every building block this needs: `createCaller` for driving tRPC procedures directly without HTTP, a fake-timer tick-acceleration pattern already used in `server-run-registry.test.ts`, and a cascade-delete cleanup pattern (delete the fixture user, the run row cascades). The one gap: the admin-configured `maxDurationSeconds` range defaults to a max of 600 seconds (10 minutes) — a 60-minute run would be rejected by the real `startServer` procedure's runtime check unless this harness raises that range first.

## Desired End State

Two exported functions: `startCorpusRun` (starts one run, raising/restoring the admin range as needed) and `collectAndCleanupCorpusRun` (reads back the finished run's full analysis payload via the real `getRunAnalysis` procedure, then deletes the fixture owner). The caller advances the shared fake-timer clock between the two calls — which is also what lets several runs tick "in parallel" with no new concurrency mechanism.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Admin-range handling | Generic widen-then-restore, scoped to whatever fields the caller's params need | Matches this project's established "generic coercion, not field-specific branching" convention; never permanently alters the shared `adminSettings` row | Plan |
| Parallelism mechanism | Split start/collect so the caller shares one timer-advance across several runs | No new concurrency primitive — Vitest's fake timers already advance every registered interval together | Plan |
| Cross-run object-count cap | Sidestepped by construction (one fresh fixture user per call) | The cap is evaluated per-user; distinct owners per parallel run never share the sum | Plan |
| Read-back method | `getRunAnalysis` procedure, not a raw DB query | Exercises the same ownership/status gates a production client hits — stays true to "driven through the real app" | Plan |

## Scope

**In scope:**
- `ensureAdminRangesAdmit`, `startCorpusRun`, `collectAndCleanupCorpusRun` in a new `scripts/corpus/harness.ts`.
- Tests covering the range-widening helper's logic and one full round trip.

**Out of scope:**
- The actual ~20-run sweep, fixture-file export format, and parallel-batching loop (S-33).
- Any client-staged-path equivalent (server-owned only, matching the whole milestone's scope).
- Any change to existing validation functions (`checkAgainstAdminRanges` etc.) — only called indirectly via `startServer`.

## Architecture / Approach

A plain library module, not a test file, so it's importable by S-33's generation test. `startCorpusRun` and `collectAndCleanupCorpusRun` are deliberately split (rather than one "run and return" function) specifically so a caller can register several runs before advancing time once for the whole batch.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Harness functions | Both exported functions + the range-widening helper + tests | Low — every building block (createCaller, fake timers, cascade cleanup) already has a proven precedent in this codebase; the only new logic is the generic range-widen-and-restore helper |

**Prerequisites:** None.
**Estimated effort:** Small — one phase, reuses existing patterns end-to-end.

## Open Risks & Assumptions

- Assumes the caller (S-33) correctly advances fake time past `maxDurationSeconds` before calling `collectAndCleanupCorpusRun` — this foundation throws rather than silently waiting if the run hasn't actually stopped yet, so a misordered caller fails loudly, not silently.
- `adminSettings` is a pre-existing shared-mutable-singleton table across parallel test-file workers (plan-review F2) — this harness's widen-then-restore doesn't introduce a new risk class, but doesn't eliminate the existing one either.
- `getOrSeedAdminSettings`'s seed-if-absent logic is deliberately duplicated, not imported (plan-review F3) — it's a private, non-exported helper in `simulation.ts`.

## Success Criteria (Summary)

- A single server-owned run, started with `maxDurationSeconds: 3600`, completes and its full analysis payload is retrievable, with zero DB/registry footprint left afterward and the admin `adminSettings` row restored to its pre-call state.
