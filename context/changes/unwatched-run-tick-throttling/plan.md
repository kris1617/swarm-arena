# Unwatched-run tick throttling Implementation Plan

## Overview

Give unwatched server-owned simulation runs (zero active viewers) a fixed 3x
speed multiplier on their simulated `dtSeconds`, relieving single-core CPU
contention against the run the user is actively watching, while marking any
run that is ever throttled with a sticky `wasEverThrottled` flag so its
score/history is never silently treated as comparable to a run that never
used this feature.

## Current State Analysis

- Server-owned runs tick on a real-time `setInterval` fired every
  `TICK_INTERVAL_MS = 16` (`src/server/simulation/server-run-registry.ts:27`).
  `tick()` (`server-run-registry.ts:445`) calls `computeSingleRunTick(...,
  Date.now(), ...)` (`server-run-registry.ts:467`), which derives
  `dtSeconds` from the real wall-clock gap, clamped at `MAX_DT_SECONDS = 0.1`
  (`single-run-lifecycle.ts:17`, `:99-104`).
- `watchServerRun` (`server-run-registry.ts:773-802`) is a plain async
  generator (per `lessons.md`'s tRPC-subscription-testability rule) that
  polls `getLiveRunState` every `WATCH_INTERVAL_MS = 150` until its
  `AbortSignal` fires. Multiple independent callers can watch the same
  `runId` concurrently; the registry currently has **no concept of how many
  watchers a run has** — ticking and watching are fully decoupled today.
- A user can leave `/simulation` (ending their watch subscription) and
  return later via the running-runs switcher to re-watch the same still-live
  run — watched→unwatched→watched is a normal, repeatable flow, not an edge
  case.
- S-25's existing "comparability marker" precedent
  (`context/archive/2026-11-15-area-aware-population-insight/`) is a derived
  JSON-presence check on the schema-less `history` blob
  (`scoredWithAreaFactor` in `listLeaderboard`, `simulation.ts:729-732`;
  `areaPopulationDensity: number | null` in `getRunsComparison`,
  `simulation.ts:952-957`) — not a DB column. This plan deliberately diverges
  from that precedent (see Decision below).
- `scripts/perf-baseline.ts` (`testing-perf-baseline` rollout phase) already
  exists and exports `runBenchmarkGrid` for measuring tick-grid wall-clock
  cost; `context/foundation/perf-baseline.json` holds one committed baseline
  entry.

### Key Discoveries:

- Multiplier injection point: `single-run-lifecycle.ts:99-104`, scaling the
  computed `dtSeconds` before the `MAX_DT_SECONDS` clamp. The scheduler
  interval (`TICK_INTERVAL_MS`) is untouched — only the simulated-time delta
  passed into tick math changes.
- No viewer-count mechanism exists; it must be added inside
  `watchServerRun`/`LiveRun`.
- The marker must reach 3 surfaces, not 2: leaderboard (`listLeaderboard`,
  `simulation.ts:701-734`), run-comparison (`getRunsComparison`,
  `simulation.ts:877-958`+), and the parameter-suggestion heuristic
  (`getParameterSuggestion`, `simulation.ts:741-789`, backed by
  `suggestParameterChange` in `src/server/simulation/parameter-suggestion.ts`)
  — the last one was not named in the original framing but runs an unweighted
  Pearson correlation over every stopped run's score with no existing
  disclosure mechanism.

## Desired End State

A run that has zero active watchers for 5 continuous seconds starts ticking
its simulated time 3x faster than real time, relieving CPU pressure on any
concurrently-watched run. The first time this actually happens to a run, it
is permanently flagged `wasEverThrottled = true`. The leaderboard and the
parameter-suggestion heuristic include such runs but disclose them (badge /
rationale text); run-comparison shows a disclaimer note on an affected row,
matching the existing legacy-row pattern.

**Verification**: a throttled run's `wasEverThrottled` column reads `true`
after a period with zero watchers; leaderboard shows the disclosure badge on
such a run; `getParameterSuggestion`'s rationale text reports how many
throttled runs were included; run-comparison shows the disclaimer note for
an included throttled run; a perf-baseline run confirms a concurrently
watched run's own tick time does not regress when a background run is
throttled.

## What We're NOT Doing

- Not excluding throttled runs from any query — flag-and-include only, on
  every surface (user decision).
- Not adding a grace-period exemption finer than a single 5-second timer per
  run — no per-user or per-session nuance.
- Not touching the single-run analysis page (`src/app/runs/[runId]/page.tsx`)
  — it is not a cross-run comparison surface (confirmed in research.md) and
  S-25 itself never extended its marker there either.
- Not touching the parameter-sweep test corpus fixtures
  (`corpus-db-fixture.ts`/`corpus-fixture.ts`) — these are synthetic rows
  that predate this feature and were never live-ticked, so `wasEverThrottled`
  correctly defaults to `false`/absent for all of them; no code change
  needed (plan-review F1 follow-up note).
- Not changing `WATCH_INTERVAL_MS` (the watch-snapshot poll cadence) or
  `TICK_INTERVAL_MS` (the tick scheduler cadence) — only the simulated
  `dtSeconds` value changes for a throttled run.
- Not wiring this into CI — the perf-baseline comparison stays the manual,
  pre-merge gate `test-plan.md §5` already documents for simulation-engine
  perf changes.

## Implementation Approach

Thread a per-run watcher `Set<subscriberId>` through `LiveRun`, with a
5-second grace timer that starts when the set becomes empty. `tick()` reads
whether the grace period has elapsed with zero watchers and, if so, passes a
multiplier into `computeSingleRunTick`, which applies it to `dtSeconds`
before the existing clamp. The first tick where the multiplier is actually
applied writes `wasEverThrottled = true` to the DB row (not merely when the
watcher count reaches zero, since the grace period can elapse without the
multiplier ever engaging if a watcher reattaches first). Each of the three
query surfaces independently picks up the new column and extends its own
existing disclosure pattern.

## Phase 1: Schema migration

### Overview

Add the sticky comparability marker column.

### Changes Required:

#### 1. Simulation runs schema

**File**: `src/server/db/schema.ts`

**Intent**: Add a column recording whether a run was ever throttled while
unwatched, so every downstream query can filter or flag on it directly in
SQL (the reason this plan diverges from S-25's JSON-presence precedent — see
Current State Analysis).

**Contract**: `wasEverThrottled: d.integer({ mode: "boolean" }).notNull().default(false)` on `simulationRuns`, following this schema's existing boolean-column convention (match whatever mode other boolean columns on this table already use, e.g. `crossbreedingEnabled`). Generate the migration with `npm run db:generate`; SQLite applies the `default(false)` to all existing rows automatically — no separate backfill `UPDATE`.

**Implementation note (adaptation)**: neither `npm run db:push` (interactive TTY prompt, can't run non-interactively here) nor `npm run db:migrate` (fails silently — this local `db.sqlite`'s `__drizzle_migrations` tracking table is empty despite 9 prior migrations already reflected in its schema, a pre-existing state issue) nor `db:push --force` (drizzle-kit's internal ALTER-statement builder mis-quotes this project's leading-dot table names, `SqliteError: near ".": syntax error`) actually applies cleanly against this local DB. The already-generated migration file's own SQL is correctly quoted; it was applied directly via a plain `@libsql/client` `execute()` call reading `drizzle/0009_many_zemo.sql` verbatim, bypassing drizzle-kit's push/migrate tooling entirely. Automated Verification below reflects this.

### Success Criteria:

#### Automated Verification:

- Migration generates cleanly: `npm run db:generate` (applied to local `db.sqlite` via a direct SQL execute of the generated file — see Implementation Note above, since this repo's `db:push`/`db:migrate` don't apply cleanly against this local DB's current state)
- Typecheck passes: `npm run typecheck`
- Lint passes: `npm run check`

#### Manual Verification:

- Query confirms the new column exists on existing rows as `false`/`0`.

---

## Phase 2: Throttling mechanism

### Overview

Track active watchers per run, apply the grace period, scale `dtSeconds` for
a genuinely-unwatched run, and write the sticky marker the first time
throttling actually engages.

### Changes Required:

#### 1. Viewer tracking on `LiveRun`

**File**: `src/server/simulation/server-run-registry.ts`

**Intent**: Give the registry a concept of "how many watchers does this run
have right now" and "how long has it had zero", so `tick()` can decide
whether to throttle.

**Contract**: Add `watcherIds: Set<string>` and `unwatchedSinceMs: number | null` to `LiveRun`. `watchServerRun` generates a unique subscriber id, then (after the three existing early-throw guard clauses — row-not-found, forbidden, not-active) wraps the entire `while` statement in exactly one `try { watcherIds.add(id); while (...) {...} } finally { watcherIds.delete(id); ... }` for the generator's whole lifetime — added once before the loop starts, removed once when the generator exits for any reason (normal `AbortSignal` exit, the loop's own early `return`, or a thrown error), never re-added/removed per poll iteration (plan-review F2). When `watcherIds` transitions to empty, set `unwatchedSinceMs = Date.now()`; when a new watcher attaches, reset `unwatchedSinceMs = null`.

#### 2. Multiplier application in the tick core

**File**: `src/server/simulation/single-run-lifecycle.ts`

**Intent**: Scale the simulated time delta for a throttled run, without
touching the real-time scheduler.

**Contract**: `computeSingleRunTick`'s `params` argument gains an optional `speedMultiplier?: number` (default `1`). Apply it to the computed `dtSeconds` before the `MAX_DT_SECONDS` clamp:
```ts
const dtSeconds = Math.min(
  ((timestamp - previousTimestamp) / 1000) * (params.speedMultiplier ?? 1),
  MAX_DT_SECONDS,
);
```
Also return a `wasThrottledThisTick: boolean` (`speedMultiplier > 1`) in the result so the caller (`tick()`) knows whether to persist the sticky marker.

#### 3. Wiring `tick()` to compute and apply the multiplier, and persist the marker

**File**: `src/server/simulation/server-run-registry.ts`

**Intent**: Decide per-tick whether the grace period has elapsed with zero
watchers, pass the fixed `3` multiplier into `computeSingleRunTick` when it
has, and write `wasEverThrottled = true` on the DB row the first time
`wasThrottledThisTick` comes back `true` for that run (guard with an
in-memory flag on `LiveRun` so the write happens at most once per run's
life, not on every throttled tick).

**Contract**: In `tick()` (`server-run-registry.ts:445`), compute `const isThrottled = run.unwatchedSinceMs !== null && Date.now() - run.unwatchedSinceMs >= GRACE_PERIOD_MS;` with a new `const GRACE_PERIOD_MS = 5_000;` and `const THROTTLE_SPEED_MULTIPLIER = 3;` constants near `TICK_INTERVAL_MS`. Pass `speedMultiplier: isThrottled ? THROTTLE_SPEED_MULTIPLIER : 1` into `computeSingleRunTick`'s params. On a result with `wasThrottledThisTick: true` and `run.wasEverThrottledWritten` not yet set, issue a single `UPDATE simulationRuns SET wasEverThrottled = true WHERE id = ?` and set the in-memory flag so later throttled ticks in the same run's life don't re-issue the write.

### Success Criteria:

#### Automated Verification:

- Unit tests: `watchServerRun` called twice concurrently for the same run leaves `watcherIds.size === 2`; after both signals abort, `watcherIds.size === 0`.
- Unit tests: `computeSingleRunTick` with `speedMultiplier: 3` produces a `dtSeconds` 3x the unscaled value (below the `MAX_DT_SECONDS` clamp) and `wasThrottledThisTick: true`; with `speedMultiplier: 1` (or omitted), behavior is unchanged from before this phase (regression check).
- Unit tests: a run ticked with zero watchers for less than `GRACE_PERIOD_MS` does NOT throttle; at/after `GRACE_PERIOD_MS` it does.
- Typecheck passes: `npm run typecheck`
- Lint passes: `npm run check`
- Full suite passes: `npm test`

#### Manual Verification:

- Start a server-owned run, watch it, then navigate away; after ~5s, query the DB row and confirm `wasEverThrottled` becomes `true`; re-watch the same run and confirm it keeps ticking without error.

---

## Phase 3: Cross-run surfaces

### Overview

Surface the marker everywhere runs are compared or aggregated, matching the
existing legacy-row disclosure pattern each surface already has.

### Changes Required:

#### 1. Leaderboard

**File**: `src/server/api/routers/simulation.ts` (`listLeaderboard`, `:701-734`)

**Intent**: Include `wasEverThrottled` in the selected/returned row shape so the client can badge it, exactly like `scoredWithAreaFactor` already is.

**Contract**: Add `wasEverThrottled: simulationRuns.wasEverThrottled` to the `.select({...})` projection and pass it straight through on the returned row (no derivation needed, unlike `scoredWithAreaFactor` — it's already a real column).

**File**: `src/app/leaderboard/page.tsx` (`:65-72`)

**Intent**: Render a second disclosure badge, sibling to the existing "4-factor score" one, when a row is throttled.

**Contract**: Add `{run.wasEverThrottled && (<span ...title="Ticked at an accelerated rate while unwatched">Accelerated run</span>)}` using the same badge classes as the existing `!run.scoredWithAreaFactor` badge.

#### 2. Parameter-suggestion heuristic

**File**: `src/server/api/routers/simulation.ts` (`getParameterSuggestion`, `:741-789`)

**Intent**: Include throttled runs in the correlation input (per the flag-and-include decision) but count how many were included so the rationale can disclose it.

**Contract**: Add `wasEverThrottled: simulationRuns.wasEverThrottled` to the `.select({...})` projection; compute `const throttledCount = rows.filter((r) => r.wasEverThrottled).length;` before building `inputRows`, and pass it through to `suggestParameterChange` (new optional param) or append a disclosure clause to the existing `rationale` string when `throttledCount > 0` (e.g. `" (includes N run(s) ticked at an accelerated rate while unwatched.)"`).

**File**: `src/server/simulation/parameter-suggestion.ts`

**Intent**: Compose the disclosure clause into the existing rationale text without changing the correlation math itself (the flag-and-include decision accepts the statistical skew as disclosed, not fixed).

**Contract**: `suggestParameterChange`'s signature gains an optional `throttledCount?: number` parameter; when `> 0`, append the disclosure clause to the `"ok"`-status result's `rationale` field.

#### 3. Run export

**File**: `src/server/simulation/run-export.ts`

**Intent**: Carry the marker through to the single-run JSON/CSV export feature, which is a close cousin of run-comparison's disclosure need (plan-review F1).

**Contract**: Add `wasEverThrottled: boolean` to `RunExportRow` and a corresponding entry in `CSV_COLUMNS`, sourced directly from `run.wasEverThrottled`.

#### 4. Run comparison

**File**: `src/server/api/routers/simulation.ts` (`getRunsComparison`, `:877-958`+)

**Intent**: Extend the per-row result shape with the marker so the comparison page can disclaim it, exactly like the existing `areaPopulationDensity === null` legacy check.

**Contract**: Add `wasEverThrottled: boolean` to the success-row union member's shape (sibling to `breakdown`), sourced directly from `run.wasEverThrottled`.

**File**: `src/app/runs/compare/page.tsx` (`:135-150`)

**Intent**: Add a second per-row disclaimer paragraph, mirroring the existing legacy-row block exactly.

**Contract**: After the existing `.filter((row) => row.breakdown?.areaPopulationDensity === null)` block, add a sibling block: `okRows.filter((row) => row.wasEverThrottled).map((row) => (<p ...>Run #{row.runId} ticked at an accelerated rate while unwatched — its score may not be directly comparable.</p>))`.

### Success Criteria:

#### Automated Verification:

- Unit/integration tests: `listLeaderboard` row includes `wasEverThrottled` matching the DB value; `getParameterSuggestion`'s rationale contains the disclosure clause when at least one selected row has `wasEverThrottled = true`, and omits it when none do; `getRunsComparison` row includes `wasEverThrottled` matching the DB value; the run-export JSON/CSV output includes `wasEverThrottled`.
- Typecheck passes: `npm run typecheck`
- Lint passes: `npm run check`
- Full suite passes: `npm test`

#### Manual Verification:

- Leaderboard shows the new badge on a throttled run's row.
- Run comparison shows the new disclaimer paragraph when one of the 2-4 compared runs is throttled.
- Parameter suggestion's displayed rationale text visibly mentions the throttled-run count when applicable.
- Exported JSON/CSV for a throttled run includes `wasEverThrottled: true`.

---

## Phase 4: Validation

### Overview

Confirm the chosen 3x multiplier actually relieves contention on a
concurrently-watched run, using the project's existing perf-baseline
harness, per `test-plan.md §5`'s wall-clock-comparison gate.

### Changes Required:

#### 1. Benchmark comparison

**File**: n/a (manual run of existing `scripts/perf-baseline.ts` harness — no code change)

**Intent**: Run the existing benchmark grid with a throttled background run active alongside a foreground run at the same object count, and compare the foreground run's own tick time against the baseline entry in `context/foundation/perf-baseline.json` with no background run — confirming no regression within the harness's existing variance tolerance.

**Contract**: n/a (measurement only).

#### 2. Cookbook note

**File**: `context/foundation/test-plan.md` (§6 cookbook)

**Intent**: Record the outcome of the validation run as a reference point for future simulation-engine perf changes, matching the existing §6.7/§6.8/§6.9 entry format.

**Contract**: New `### 6.10` entry naming the multiplier value, the grace period, and the measured before/after comparison result.

### Success Criteria:

#### Automated Verification:

- n/a — this phase is manual-only by `test-plan.md §5`'s own documented scope.

#### Manual Verification:

- Run `npm run perf:baseline` (or a representative config subset) with a throttled background run active; compare the foreground run's tick time against the latest `perf-baseline.json` entry; confirm no regression.
- New `§6.10` cookbook entry added to `test-plan.md`.

---

## Testing Strategy

### Unit Tests:

- `computeSingleRunTick` multiplier scaling and `wasThrottledThisTick` flag (regression-safe for `speedMultiplier` omitted/`1`).
- `watchServerRun` watcher-set add/remove under concurrent calls and abort.
- `suggestParameterChange`'s rationale disclosure clause presence/absence.

### Integration Tests:

- `listLeaderboard`, `getParameterSuggestion`, `getRunsComparison` each surfacing `wasEverThrottled` correctly from a seeded throttled row.

### Manual Testing Steps:

1. Start and watch a run, navigate away, wait >5s, confirm DB flag flips and badges/disclaimers appear on the 3 surfaces.
2. Re-watch the same run after it was throttled; confirm it keeps ticking at 1x once watched again and the marker stays `true`.
3. Run the perf-baseline validation per Phase 4.

## Performance Considerations

The multiplier only scales a passed-in `dtSeconds` value — it does not change
the real-time scheduler cadence or per-tick CPU cost of a single run. Its
entire purpose is to let an unwatched run "catch up" faster in simulated
time while contributing the same per-tick CPU cost as before; Phase 4
validates this empirically rather than asserting it.

## Migration Notes

New column defaults to `false` for all existing rows via Drizzle's
`.default(false)` — no separate backfill `UPDATE` needed (every
pre-existing run predates this feature and was, by definition, never
throttled).

## References

- Research: `context/changes/unwatched-run-tick-throttling/research.md`
- S-25 precedent (for contrast, not pattern copy): `context/archive/2026-11-15-area-aware-population-insight/plan.md`
- Existing wall-clock-comparison gate: `context/foundation/test-plan.md §5`
- Perf harness: `scripts/perf-baseline.ts`, `context/foundation/perf-baseline.json`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Schema migration

#### Automated

- [x] 1.1 Migration generates and applies cleanly (via direct SQL execute, see Implementation Note) — 1a980d1
- [x] 1.2 Typecheck passes: `npm run typecheck` — 1a980d1
- [x] 1.3 Lint passes: `npm run check` — 1a980d1

#### Manual

- [x] 1.4 Query confirms the new column exists on existing rows as `false`/`0` — 1a980d1

### Phase 2: Throttling mechanism

#### Automated

- [ ] 2.1 Unit tests: watcher-set add/remove under concurrent watchServerRun calls and abort
- [ ] 2.2 Unit tests: computeSingleRunTick multiplier scaling, wasThrottledThisTick flag, and speedMultiplier-omitted regression check
- [ ] 2.3 Unit tests: grace-period boundary (below vs at/after GRACE_PERIOD_MS)
- [ ] 2.4 Typecheck passes: `npm run typecheck`
- [ ] 2.5 Lint passes: `npm run check`
- [ ] 2.6 Full suite passes: `npm test`

#### Manual

- [ ] 2.7 Watch a run, navigate away, confirm wasEverThrottled flips to true after ~5s and re-watching still works

### Phase 3: Cross-run surfaces

#### Automated

- [ ] 3.1 Integration tests: listLeaderboard, getParameterSuggestion, getRunsComparison, and run-export each surface wasEverThrottled correctly
- [ ] 3.2 Typecheck passes: `npm run typecheck`
- [ ] 3.3 Lint passes: `npm run check`
- [ ] 3.4 Full suite passes: `npm test`

#### Manual

- [ ] 3.5 Leaderboard badge, run-comparison disclaimer, parameter-suggestion rationale, and exported JSON/CSV all visibly disclose a throttled run

### Phase 4: Validation

#### Manual

- [ ] 4.1 perf-baseline comparison run shows no regression on the watched foreground run
- [ ] 4.2 §6.10 cookbook entry added to test-plan.md
