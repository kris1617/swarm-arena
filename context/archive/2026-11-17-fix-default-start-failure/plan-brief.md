# Fix default-parameter simulation start — Plan Brief

> Full plan: `context/changes/fix-default-start-failure/plan.md`
> Research: `context/changes/fix-default-start-failure/research.md`

## What & Why

Starting a simulation reportedly doesn't work, even with the form's own
default values. Research found no validation rule rejects the literal
defaults — the real cause is architectural: `running` rows are never
reconciled after a server restart (which happens on every deploy), and
separately, the Start buttons never show the user why a request failed.
This plan fixes both.

## Starting Point

`insertRunningSimulation` caps each user at 4 concurrent `running` rows
(`MAX_PARALLEL_RUNS`). The server-owned run registry is a pure in-memory
`Map` with zero startup reconciliation; every production deploy destroys
and recreates it while `simulationRuns` rows persist untouched in SQLite.
Neither `start` nor `startServer`'s client mutation has an `onError`
handler or renders its error — unlike the sibling `savePauseMutation`,
which already does.

## Desired End State

A user who starts a simulation either sees it start, or sees a specific
error message — never silent nothing. A `running` row that's provably past
its own `maxDurationSeconds` deadline gets automatically marked `stopped`
within 5 minutes, freeing its quota slot, whether it was server-owned or
client-staged (browser tab closed). Any auto-stopped run is clearly marked
wherever it's shown, not left to blend in as an unexplained entry.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| Sweep timing | Startup + every 5 min | Catches both immediately-orphaned rows and ones that go stale later during uptime | Plan |
| Grace period | 2 minutes past duration cap | Generous enough to avoid sweeping a run mid-legitimate-stop | Plan |
| Error UX | Show the server's own message | Reuses the existing `savePauseMutation.error` pattern; server messages are already user-facing | Plan |
| Sweep scope | Both client-staged and server-owned | No DB column distinguishes them, and the duration-deadline signal is safe for either; fixing only one path leaves an identical bug in the other | Plan |
| Backfill for already-stuck prod rows | None — the sweep's own first deploy covers it | Avoids a second, one-off mechanism for something the automated fix already handles | Plan |
| Auto-stopped marker | Add a visible one everywhere a run appears | A user shouldn't see an unexplained stopped run with no indication of why | Plan |

## Scope

**In scope:**
- `onError`/error rendering for both start mutations
- New `wasAutoStopped` schema column + migration
- Startup + periodic (5 min) reconciliation sweep, grace 2 min
- Surfacing the marker on dashboard, run-detail, and compare pages

**Out of scope:**
- Resuming/recovering a stale run's actual tick state (not possible — no
  per-tick state is persisted for either path)
- A manual backfill command for currently-stuck production rows
- A new DB column to distinguish execution paths
- Changing `MAX_PARALLEL_RUNS` or any admin-configured range/cap

## Architecture / Approach

Phase 1 is a pure client fix (smallest independent win). Phase 2 adds the
schema column and a scheduled sweep living in
`server-run-registry.ts`, using the same `globalThis`-cached-timer pattern
already established there for HMR safety. Phase 3 threads the new column
through the three existing read paths (`listCompleted`, `getRunAnalysis`,
`getRunsComparison`) and their pages, reusing each page's existing
badge/disclaimer-paragraph conventions rather than inventing new UI.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Surface start-mutation errors | Any start rejection is now visible to the user | Low — additive UI only, no behavior change |
| 2. Add orphan reconciliation | Stale `running` rows self-correct within 5 min, no more permanent quota loss | Medium — a wrong grace/deadline calculation could sweep a legitimately-active run |
| 3. Surface the auto-stopped marker | User understands why an unfamiliar stopped run appeared | Low — purely additive read/render path |

**Prerequisites:** None beyond the current codebase state; no external access needed.
**Estimated effort:** 3 phases, each independently shippable and verifiable.

## Open Risks & Assumptions

- Assumes client-staged runs enforce `maxDurationSeconds` as a hard stop the
  same way the server-owned path does (confirmed the field is passed
  through; the exact client-side enforcement code wasn't traced line-by-line
  in planning — verify during Phase 2 implementation).
- Whether the reporting account currently has ≥4 stuck production rows is
  unconfirmed (no production DB access this session) — per the Backfill
  decision, this plan doesn't depend on that answer; the fix self-corrects
  on its first deploy regardless.

## Success Criteria (Summary)

- Starting a simulation with defaults either succeeds or shows a specific,
  readable error — never silent nothing.
- A `running` row with no process ticking it is automatically resolved
  within 5 minutes of becoming stale, under either execution path.
- An auto-stopped run is clearly marked wherever it appears, not confusable
  with a normal or legacy stopped run.
