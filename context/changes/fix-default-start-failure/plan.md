# Fix default-parameter simulation start — Implementation Plan

## Overview

Starting a simulation is reported as not working, even with the form's own
default values. Research found no validation rule that rejects the literal
defaults — the real bug is architectural: the server-owned run registry is a
plain in-memory `Map` with no reconciliation after a process restart (which
happens on every production deploy), and separately, neither start mutation
ever surfaces a server error to the user. This plan closes both gaps and adds
a periodic sweep that marks genuinely-abandoned `running` rows `stopped`,
covering both execution paths (client-staged and server-owned).

## Current State Analysis

- UI defaults (`src/app/simulation/page.tsx:33-51`) all fall inside the
  seeded `admin_settings.parameterRanges`/`maxObjectCount` bounds — confirmed
  directly against the local dev database. No schema or range check rejects
  them.
- `startRun`/`startServerMutation` (`src/app/simulation/page.tsx:212-245`)
  have only an `onSuccess` callback. No `onError`, and no JSX anywhere on the
  page reads either mutation's `.error`. The sibling `savePauseMutation`
  already renders `.error.message` conditionally
  (`src/app/simulation/page.tsx:311-314`) — the established pattern this plan
  reuses, just not applied to the two start mutations today.
- `insertRunningSimulation` (`src/server/api/routers/simulation.ts:277-300`)
  enforces a hard per-user cap of `MAX_PARALLEL_RUNS = 4`
  (`src/server/simulation/run-slots.ts:4`) by counting `status: "running"`
  rows — a pure DB query with no liveness cross-check.
- The server-owned run registry (`src/server/simulation/server-run-registry.ts:144-154`)
  is a `Map<number, LiveRun>`, cached on `globalThis` only in non-production
  to survive Next.js dev HMR. In production, every deploy rebuilds the image
  (`docker compose build app`) and recreates the container
  (`context/deployment/deploy-plan.md:15`), fully destroying this Map. The
  backing SQLite file survives (`context/deployment/deploy-plan.md:36`), so
  any row that was `status: "running"` at the moment of a deploy is carried
  forward into the new process with nothing tracking it — permanently
  orphaned.
- No DB column distinguishes a client-staged (`start`) row from a
  server-owned (`startServer`) one. A client-staged run that orphans because
  its browser tab closed mid-run has the identical DB shape and the
  identical permanent-orphan outcome, independent of any deploy.
- Both execution paths already receive and enforce `maxDurationSeconds` as a
  hard lifespan cap (`server-run-registry.ts:328,609-612` for the
  server-owned tick loop; the same field is passed to the client's own loop,
  `src/app/simulation/page.tsx:234,369`). This makes
  `startedAt + maxDurationSeconds` a safe, execution-path-agnostic signal:
  any row still `running` well past that deadline cannot be legitimately
  active under either path's own rules.
- `listCompleted` (`src/server/api/routers/simulation.ts:688-711`) already
  has a documented, tested convention for a stopped row with no score
  (`"includes a stopped row with a null score"`, referenced at
  `simulation.ts:716-717`) — the dashboard
  (`src/app/dashboard/page.tsx:180-185`) already has a comment anticipating
  "a run that failed to start lands here with no score." A swept, orphaned
  row is exactly this shape; no new null-handling is needed, only a reason
  to show alongside it.
- `listLeaderboard` already filters `isNotNull(simulationRuns.score)`
  (`simulation.ts:718-731`) — an orphan-swept row (always null score) is
  automatically excluded from the leaderboard with no change needed there.

### Key Discoveries:

- The missing `onError` (not a validation bug) is independently responsible
  for the exact "funny — it just doesn't work, no explanation" experience
  reported, regardless of what triggers a given rejection.
- `maxDurationSeconds` already being enforced on both paths removes the need
  for a new schema column to distinguish client-staged from server-owned
  runs when deciding what's safe to sweep.
- No production DB access exists in this environment, so whether the
  reporting account currently has ≥4 stuck rows is unconfirmed (see
  `research.md`'s Open Questions). Per the "Backfill" decision below, this
  plan does not require that confirmation — the new sweep self-corrects on
  its own first deploy.

## Desired End State

A user can start a simulation with the form's defaults (or any valid
values) and either see it start, or see a specific, readable error message
if it's rejected — never silent, unexplained nothing. A `running` row that
can no longer possibly be legitimate (past its own `maxDurationSeconds`
deadline plus a grace window) is automatically marked `stopped` within 5
minutes of becoming stale, freeing its `MAX_PARALLEL_RUNS` slot, regardless
of whether it was server-owned or client-staged. Any run auto-stopped this
way is visibly marked as such everywhere it's shown (dashboard, run-detail,
compare) rather than blending in as an unexplained null-score stop.

Verification: `npm run typecheck`, `npm run check`, `npm test`, plus a
manual pass starting a run with pure defaults and confirming no silent
failure, and a manual pass forcing a stale row (via direct DB edit in a test
environment) and confirming the sweep marks it `stopped` with the new
marker visible.

## What We're NOT Doing

- Not attempting to resume or recover a stale run's actual tick state —
  nothing persists per-tick state for either execution path, so the only
  recoverable action is marking the row `stopped` with no score (the
  existing convention for a run that never completes normally).
- Not adding a manual, immediate backfill command for currently-stuck
  production rows — per the "Backfill" decision, the new sweep's own first
  deploy handles any already-stuck rows automatically.
- Not adding a distinguishing DB column for client-staged vs. server-owned
  runs — the duration-deadline signal is safe for both without one.
- Not changing `MAX_PARALLEL_RUNS`, `maxConcurrentObjectCount`, or any
  admin-configured range — this plan fixes false-positive rejections caused
  by stale state, not the caps themselves.
- Not adding toast/snackbar UI — reusing the existing inline-error pattern
  already on this page.

## Implementation Approach

Three independently-shippable phases, each fixing a distinct part of the
reported symptom:

1. Make start failures visible at all (client-only change, no schema, ships
   the smallest fix for the reported symptom immediately).
2. Add the reconciliation sweep (schema + server-side scheduling) that
   prevents the underlying cause from recurring.
3. Surface the new marker everywhere a swept run appears, so "why did this
   run just stop" is never a mystery to the user either.

## Phase 1: Surface start-mutation errors to the user

### Overview

Give `startRun` and `startServerMutation` the same error-visibility pattern
`savePauseMutation` already has on this page, so any future rejection —
known or not-yet-discovered — is never silent again.

### Changes Required:

#### 1. Client start mutations

**File**: `src/app/simulation/page.tsx`

**Intent**: Add an `onError` handler to both `startRun` and
`startServerMutation` (mirroring the existing `onSuccess`-only shape), and
render each mutation's `.error.message` near its own trigger button when
present — same conditional-render pattern already used for
`savePauseMutation.error` at lines 311-314.

**Contract**: No new state needed — `useMutation`'s own `.error` field
already carries the message; this only wires it to the existing JSX
pattern. Two separate render sites (one per mutation, next to the "Start"
and "Start on server" buttons respectively), not a single shared error
banner, so a failure is visible next to the control that caused it.

### Success Criteria:

#### Automated Verification:

- `npm run typecheck` passes
- `npm run check` passes (Biome)
- `npm test` passes (no existing test asserts the absence of error
  rendering, so no regression expected; confirm no test needs updating)

#### Manual Verification:

- Temporarily force a rejection (e.g. start a 5th simulation while 4 are
  already running) and confirm the server's message appears next to the
  Start button instead of the button silently reverting.
- Confirm a normal, successful start is unaffected (no error UI shown).

---

## Phase 2: Add orphan reconciliation

### Overview

Add a `wasAutoStopped` marker column and a sweep that marks any `running`
row past its own `startedAt + maxDurationSeconds + 2min` deadline as
`stopped`, running once at server startup and then every 5 minutes, covering
both client-staged and server-owned rows identically.

### Changes Required:

#### 1. Schema: auto-stopped marker

**File**: `src/server/db/schema.ts`

**Intent**: Add a sticky boolean marker recording that a row was stopped by
the reconciliation sweep rather than by its own normal completion path —
mirrors the existing `wasEverThrottled` column's naming and intent
(a derived, UI-relevant fact about how a run ended, not a core simulation
parameter).

**Contract**: `wasAutoStopped: d.integer({ mode: "boolean" }).notNull().default(false)`,
placed alongside `wasEverThrottled` in `simulationRuns`. Existing rows
backfill to `false` automatically (same default-based migration pattern
already used for that column).

#### 2. Migration

**File**: new file under `drizzle/` (generated)

**Intent**: Generate and commit the migration for the new column.

**Contract**: Run `npm run db:generate` after the schema edit, then
`npm run db:migrate` locally to verify it applies cleanly. The production
deploy's own `drizzle-kit migrate` step (already part of
`deploy.sh`, per `context/deployment/deploy-plan.md:15`) applies it on the
next deploy with no manual step needed.

#### 3. Reconciliation sweep (own module)

**File**: `src/server/simulation/orphan-sweep.ts` (new)

**Intent** (plan-review F3): a standalone periodic job, conceptually
separate from `server-run-registry.ts`'s per-run tick lifecycle — gets its
own file, mirroring `src/server/feedback/retry-worker.ts`'s own standalone
module rather than being bolted onto the already-~900-line registry file.
Exports `startOrphanSweep()`, which selects every `simulationRuns` row with
`status: "running"` and `startedAt + maxDurationSeconds*1000 + GRACE_MS <
Date.now()` — excluding any row `isServerRunActive` (imported from
`server-run-registry.ts`) still reports as active on this process, since a
server-owned run's own finalization (score/history computation) can
legitimately run past the grace window on a large population (plan-review
F1) — and updates each matching row to `status: "stopped"`,
`stoppedAt: new Date()`, `wasAutoStopped: true`, in one batch.

**plan-review F2 (resolved via `instrumentation.ts`, not a bespoke
module-load guard)**: wire `startOrphanSweep()` into `src/instrumentation.ts`'s
existing `register()` function, directly alongside the already-present
`startFeedbackRetryWorker()` call — Next's documented "run once at server
boot, every environment" hook, already proven in this codebase for exactly
this "start a background interval once" need. This sidesteps F2's entire
concern: there is no `NODE_ENV` conditional to misapply, because
`register()` itself is Next's own boot hook, not a module-load side effect.
Follow `startFeedbackRetryWorker`'s own de-duplication pattern exactly
(`retry-worker.ts`'s `globalForRetryWorker.feedbackRetryWorkerStarted`
boolean flag, unconditional in every environment) — not the registry Map's
`NODE_ENV !== "production"`-gated caching, which solves a different problem
(HMR module-reload identity, not call-twice idempotency) and must not be
copied here.

**Contract**:
```ts
// src/server/simulation/orphan-sweep.ts
const GRACE_MS = 2 * 60 * 1000; // 2 minutes, per the "Grace" decision
const SWEEP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes, per the "Sweep" decision

async function sweepOrphanedRuns(): Promise<void> {
  const now = Date.now();
  const staleRows = await db
    .select({ id: simulationRuns.id, startedAt: simulationRuns.startedAt, maxDurationSeconds: simulationRuns.maxDurationSeconds })
    .from(simulationRuns)
    .where(eq(simulationRuns.status, "running"));
  const toStop = staleRows.filter(
    (row) =>
      row.startedAt.getTime() + row.maxDurationSeconds * 1000 + GRACE_MS < now &&
      // plan-review F1: never sweep a row this process's own registry still
      // tracks as active — only rows with NO live registry entry (true
      // orphans — dead process or abandoned client tab) are eligible.
      !isServerRunActive(row.id),
  );
  for (const row of toStop) {
    await db.update(simulationRuns)
      .set({ status: "stopped", stoppedAt: new Date(), wasAutoStopped: true })
      .where(eq(simulationRuns.id, row.id));
  }
}

const globalForOrphanSweep = globalThis as unknown as {
  orphanSweepStarted?: boolean;
};

export function startOrphanSweep(): void {
  if (globalForOrphanSweep.orphanSweepStarted) {
    return;
  }
  globalForOrphanSweep.orphanSweepStarted = true;
  void sweepOrphanedRuns(); // also run once immediately at boot
  setInterval(() => {
    void sweepOrphanedRuns();
  }, SWEEP_INTERVAL_MS);
}
```

#### 4. Wire the sweep into server boot

**File**: `src/instrumentation.ts`

**Intent**: Call `startOrphanSweep()` from `register()`, next to the
existing `startFeedbackRetryWorker()` call — same dynamic-import rationale
already documented there (keeping server-only DB code out of the edge
runtime's module graph).

**Contract**:
```ts
export async function register() {
  const { startFeedbackRetryWorker } = await import(
    "~/server/feedback/retry-worker"
  );
  startFeedbackRetryWorker();
  const { startOrphanSweep } = await import(
    "~/server/simulation/orphan-sweep"
  );
  startOrphanSweep();
}
```

### Success Criteria:

#### Automated Verification:

- `npm run db:generate` produces a clean migration; `npm run db:migrate`
  applies without error
- `npm run typecheck` passes
- `npm run check` passes
- New unit test (`orphan-sweep.test.ts`): a `running` row with `startedAt`
  far enough in the past (relative to its `maxDurationSeconds`) is swept to
  `stopped` with `wasAutoStopped: true`; a `running` row still within its
  deadline+grace is left untouched. Use `vi.useFakeTimers()`, matching
  `server-run-registry.ts`'s existing test conventions.
- New unit test (plan-review F1): a `running` row past its deadline+grace
  but still present in the registry (`isServerRunActive(id)` returns
  `true`) is NOT swept — confirms a legitimately-slow finalization on this
  process is never killed by the sweep.
- New unit test: calling `startOrphanSweep()` twice does not register a
  second interval — mirrors `retry-worker.test.ts`'s existing
  "calling `startFeedbackRetryWorker` twice does not register a second
  interval" test exactly.
- Updated `instrumentation.test.ts`: `register()` also calls
  `startOrphanSweep` exactly once, mocked the same way
  `startFeedbackRetryWorker` already is (same dynamic-import-mocking
  pattern, lines 6-13 of that file).
- `npm test` passes in full

#### Manual Verification:

- Insert a test row with `status: "running"` and a `startedAt` older than
  its `maxDurationSeconds` + grace, restart the dev server, and confirm it
  flips to `stopped`/`wasAutoStopped: true` without manual intervention.
- Confirm a currently-active run (started moments ago) is not touched by
  the sweep.

---

## Phase 3: Surface the auto-stopped marker across the UI

### Overview

Wire `wasAutoStopped` through the three read paths that show a stopped run,
and render a clear, distinct marker wherever it appears — so a user seeing
an unfamiliar stopped run in their list understands why, instead of it
blending in as an unexplained null-score entry.

### Changes Required:

#### 1. Dashboard run list

**File**: `src/server/api/routers/simulation.ts` (`listCompleted`), `src/app/dashboard/page.tsx`

**Intent**: Add `wasAutoStopped` to `listCompleted`'s selected columns, and
render a short badge/note (e.g. "Stopped automatically — server restarted")
next to any row where it's `true`, near the existing null-score handling
comment at `dashboard/page.tsx:180-185`.

**Contract**: `listCompleted`'s return shape gains one boolean field,
following the exact pattern `wasEverThrottled` already added to
`listLeaderboard` (`simulation.ts:718-731`).

#### 2. Run-detail page

**File**: `src/server/api/routers/simulation.ts` (`getRunAnalysis`), `src/app/runs/[runId]/page.tsx`

**Intent**: `getRunAnalysis` uses `findFirst` on the whole row
(`simulation.ts:845-847`), so `run.wasAutoStopped` is already available with
no select-shape change. Add a short inline notice on the analysis page when
`true`, styled consistently with the existing null-history guard messages
already on this page (e.g. the "no final genetic-diversity value recorded"
pattern from S-37).

**Contract**: One conditional paragraph, same section placement as the
existing null-history notices.

#### 3. Compare page

**File**: `src/server/api/routers/simulation.ts` (`getRunsComparison`), `src/app/runs/compare/page.tsx`

**Intent**: Add `wasAutoStopped` to `getRunsComparison`'s per-row success
shape (next to `comparable`/`disclaimer`, `simulation.ts` near line 1040),
and render its own disclaimer paragraph on the compare page, matching the
existing throttled-run disclaimer pattern
(`src/app/runs/compare/page.tsx`, the `!row.comparable` block) but with
distinct wording ("stopped automatically," not "may not be directly
comparable" — a different fact, not a comparability caveat).

**Contract**: One new boolean field on the success-row type; one new
conditional paragraph block, same shape as the existing one.

### Success Criteria:

#### Automated Verification:

- `npm run typecheck` passes
- `npm run check` passes
- `npm test` passes, including any updated snapshot/assertion for the three
  query shapes above

#### Manual Verification:

- With a `wasAutoStopped: true` test row, confirm the marker appears on the
  dashboard list, the run-detail page, and (when selected alongside another
  run) the compare page — with wording distinct from the existing
  "accelerated run" / "4-factor score" badges, not confusable with them.
- Confirm a normal run (`wasAutoStopped: false`) shows no marker anywhere.

---

## Testing Strategy

### Unit Tests:

- Reconciliation sweep: stale row swept, non-stale row untouched (fake
  timers).
- `listCompleted`/`getRunAnalysis`/`getRunsComparison`: each surfaces
  `wasAutoStopped` correctly for both `true` and `false` rows.

### Integration Tests:

- End-to-end: insert a stale `running` row, trigger the sweep (or wait past
  the interval in a fake-timer test), confirm it's queryable as `stopped`
  with the marker via the same tRPC procedures the UI uses.

### Manual Testing Steps:

1. Start a simulation with pure defaults — confirm it starts normally
   (baseline, unaffected by this plan).
2. Force a start rejection (4 concurrent runs) and confirm the error
   message now appears (Phase 1).
3. Manually age a `running` row past its deadline+grace, confirm the sweep
   catches it (Phase 2).
4. Confirm the swept row's marker renders on dashboard/run-detail/compare
   (Phase 3).

## Migration Notes

The new `wasAutoStopped` column defaults to `false`; every existing row
backfills automatically with no data migration needed, same as
`wasEverThrottled`'s own rollout.

## References

- Research: `context/changes/fix-default-start-failure/research.md`
- Established sticky-marker precedent: `wasEverThrottled`
  (`context/archive/2026-11-17-unwatched-run-tick-throttling/`)
- Established inline-error precedent: `savePauseMutation.error`
  (`src/app/simulation/page.tsx:311-314`)
- Established standalone-periodic-job precedent: `startFeedbackRetryWorker`
  (`src/server/feedback/retry-worker.ts`), wired via `src/instrumentation.ts`'s
  `register()` boot hook

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Surface start-mutation errors to the user

#### Automated

- [x] 1.1 `npm run typecheck` passes — fc858ec
- [x] 1.2 `npm run check` passes — fc858ec
- [x] 1.3 `npm test` passes — fc858ec

#### Manual

- [x] 1.4 Forced rejection shows the server's message next to Start — fc858ec
- [x] 1.5 Normal start shows no error UI — fc858ec

### Phase 2: Add orphan reconciliation

#### Automated

- [x] 2.1 `npm run db:generate` applied cleanly; `npm run db:migrate` failed silently on this dev DB (discovered: `__drizzle_migrations` is empty — this DB's prior 10 migrations were applied via `db:push`, not `db:migrate`, so `migrate` tried to replay all of history from scratch and collided with already-existing columns). Applied the exact generated SQL (`ALTER TABLE ... ADD wasAutoStopped integer DEFAULT false NOT NULL`) directly instead; verified column exists with the correct type/default/notnull. Production's own deploy script uses `drizzle-kit migrate` against a fresh VPS DB with a populated tracking table, so this local-only discrepancy does not affect the real deploy path.
- [x] 2.2 `npm run typecheck` passes
- [x] 2.3 `npm run check` passes
- [x] 2.4 New sweep unit test (stale row swept, fresh row untouched) passes
- [x] 2.5 New sweep unit test (registry-active stale row NOT swept) passes
- [x] 2.6 New dedup unit test (`startOrphanSweep()` called twice registers one interval) passes
- [x] 2.7 Updated `instrumentation.test.ts` (`register()` calls `startOrphanSweep` once) passes
- [x] 2.8 `npm test` passes in full

#### Manual

- [ ] 2.9 Manually-aged stale row is swept after dev-server restart
- [ ] 2.10 A currently-active run is not touched by the sweep

### Phase 3: Surface the auto-stopped marker across the UI

#### Automated

- [ ] 3.1 `npm run typecheck` passes
- [ ] 3.2 `npm run check` passes
- [ ] 3.3 `npm test` passes

#### Manual

- [ ] 3.4 Marker visible on dashboard, run-detail, and compare for a swept row
- [ ] 3.5 No marker shown for a normal run
