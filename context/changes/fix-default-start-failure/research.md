---
date: 2026-11-17T18:23:17Z
researcher: Claude (Sonnet 5)
git_commit: 10f78ce4217bcae257d1ad41c8573ed1a76e83f5
branch: master
repository: swarm-arena
topic: "Why can't a simulation be started with the form's own default parameter values?"
tags: [research, codebase, simulation-start, registry, error-handling]
status: partial
last_updated: 2026-11-17
last_updated_by: Claude (Sonnet 5)
---

# Research: default-parameter simulation start failure

**Date**: 2026-11-17T18:23:17Z
**Researcher**: Claude (Sonnet 5)
**Git Commit**: 10f78ce4217bcae257d1ad41c8573ed1a76e83f5
**Branch**: master
**Repository**: swarm-arena

## Research Question

The user reported that starting a simulation using the simulation page's own
default parameter values does not work. What causes this, and how should it
be fixed?

## Summary

No validation rule rejects the literal default values themselves — every
default (`boidCount: 100`, `predatorCount: 5`, etc., `src/app/simulation/page.tsx:33-51`)
falls inside the admin-configured ranges seeded in this environment's
`admin_settings` row, which mirror those exact defaults
(`src/app/simulation/page.tsx:33-51` vs. the seeded
`parameterRanges`/`maxObjectCount` values inspected directly in `db.sqlite`).
A live reproduction attempt in this session was inconclusive: it was blocked
first by a dev-server HMR reload-loop artifact, and second (after restarting
the server) by discovering the *previous* dev-server process had never
actually been killed — so the finding that matters is architectural, not a
single reproduced stack trace.

Two confirmed, independent defects were found instead, either of which can
produce exactly the reported symptom ("the app does nothing — Start just
doesn't work") with **zero error message shown to the user**:

1. **The client never surfaces a start failure at all** — `startRun` and
   `startServerMutation` (`src/app/simulation/page.tsx:212-245`) have no
   `onError` handler and no component anywhere in the page renders their
   `.error` field, unlike the sibling `savePauseMutation`
   (`src/app/simulation/page.tsx:311-314`), which does. Any server-side
   rejection — regardless of cause — is currently invisible: the button
   stops showing "Starting…" and silently reverts, with nothing else
   observable in the UI.

2. **A "running" simulation row is never reconciled after a server
   restart**, and this app's own production deploy process restarts the
   server on every push. The server-owned run registry is a plain in-memory
   `Map` (`src/server/simulation/server-run-registry.ts:144-154`), cached on
   `globalThis` *only* to survive Next.js dev-mode hot-module-reload
   (`if (process.env.NODE_ENV !== "production")`, same file) — in production
   this cache is not re-applied, and even where it is, the Map starts empty
   on every fresh process. No code anywhere in the repository reconciles
   `simulationRuns` rows left in `status: "running"` against what the
   registry actually has running on startup (`rg` for `orphan`,
   `recoverRun`, `reconcile.*running`, "on startup" cleanup across
   `src/server/` returned only the one comment at
   `server-run-registry.ts:144-146` describing the HMR-survival cache
   itself, not a restart-recovery mechanism). The production deploy script
   (`context/deployment/deploy-plan.md:15`) runs `docker compose build app`
   then `docker compose up -d` on every push to `master` — an image rebuild
   forces container recreation, not merely `restart`, so the Node process
   (and its in-memory registry) is fully destroyed and replaced on every
   deploy, while `simulationRuns` rows persist unchanged in the bind-mounted
   SQLite file (`context/deployment/deploy-plan.md:36`, confirmed data
   survives `docker compose restart app`). Any run that was `status:
   "running"` in the database at the instant of a deploy becomes
   permanently orphaned: nothing will ever tick it, resume it, or flip it
   to `stopped`.

   This matters because both `start` and `startServer` count a user's own
   `status: "running"` rows against a hard per-user cap of
   `MAX_PARALLEL_RUNS = 4` (`src/server/simulation/run-slots.ts:4`,
   enforced at `src/server/api/routers/simulation.ts:293-299`), and the
   check is a pure DB query — `eq(simulationRuns.userId, userId), eq(status,
   "running")` (`src/server/api/routers/simulation.ts:288-293`) — with no
   cross-check against which of those rows the in-memory registry actually
   considers alive. **This session alone triggered roughly 8-10 production
   deploys** (every push to `master` during this conversation re-ran
   `.github/workflows/deploy.yml`'s `deploy` job). If the account that
   reported the bug had any simulation running in production across any of
   those deploys, that row is stuck in `status: "running"` forever and
   silently consumes one of its 4 slots; four such orphans (plausible across
   days of normal use on this app, not just today's unusual deploy volume)
   would make every future `start`/`startServer` call — with any parameter
   values, including the exact defaults — fail with `BAD_REQUEST: "Already
   running 4 simulations — stop one before starting another."`, a message
   the user would never see per finding #1.

**This finding is not yet confirmed against live production data** — this
research session has no direct database or SSH access to the production
VPS, so the actual count of `status: "running"` rows under the reporting
user's account on `swarmarena.hopto.org` is unverified. It is the strongest
evidence-backed hypothesis available, not a proven root cause. See Open
Questions.

## Detailed Findings

### Default values pass every static validation rule (local dev DB)

- UI defaults (`src/app/simulation/page.tsx:33-51`): `boidCount: 100`,
  `separationWeight: 1`, `alignmentWeight: 1`, `cohesionWeight: 1`,
  `maxDurationSeconds: 30`, `predatorCount: 5`, `protectionThreshold: 10`,
  `foodStockInitial: 100`, `foodRegenRate: 10`, `flockCount: 2`,
  `crossbreedingEnabled: true`, `energyThreshold: 50`,
  `mutationChance: 0.1`, `mutationMagnitude: 0.2`, `xyArea: 200`,
  `zDepth: 200`.
- The local dev database's seeded `admin_settings.parameterRanges` row
  (inspected directly via `@libsql/client` against `db.sqlite`, 2026-11-17)
  has a `default` field for every one of those 14 ranged parameters that
  matches the UI's hardcoded default exactly, and every `min`/`max` bound
  comfortably contains it (e.g. `boidCount: {min:1,max:500,default:100}`,
  `predatorCount: {min:0,max:500,default:5}`). `maxObjectCount: 500` in the
  same row comfortably exceeds `boidCount + predatorCount = 105`.
  `maxConcurrentObjectCount: 150` likewise exceeds 105.
- `startInputSchema` (`src/server/api/routers/simulation.ts`, the object
  literal immediately preceding `checkAgainstAdminRanges`) has no
  cross-field `.refine()` — every field is validated independently
  (`z.number().int().positive()` etc.), so no combination-of-defaults rule
  could reject them.
- `checkAgainstAdminRanges` (`src/server/api/routers/simulation.ts:241-264`)
  loops `RANGED_PARAMETER_NAMES` checking `value < range.min || value >
  range.max`, then one combined `boidCount + predatorCount > maxObjectCount`
  check. Neither path is reachable by the defaults against the seeded
  ranges above.
- **In this local dev database**, the reporting mechanism cannot be a
  per-user running-row cap either: the user account identified in this
  session's `admin_settings`/`simulation_run` inspection (`krzysztoftatarczyk@gmail.com`)
  has **0** rows with `status: "running"` as of 2026-11-17 18:08 UTC
  (`SELECT ... WHERE status='running'` against
  `.bootstrap-scaffold_simulation_run`, scoped by that user's `userId`).

This is why the research finding centers on production's deploy-vs-registry
mismatch rather than a local reproduction: the local dev database's state
does not currently exhibit the failure, but the architecture that would
cause it in production is real and independently confirmed.

### The start mutations have no error path (client)

- `src/app/simulation/page.tsx:212-245` — both `startServerMutation` and
  `startRun` are defined with only an `onSuccess` callback; neither
  configuration object contains an `onError` key.
- No JSX anywhere between lines 246 and 560 of that file reads
  `startRun.error` or `startServerMutation.error`. Contrast with
  `savePauseMutation.error`, rendered at `src/app/simulation/page.tsx:311-314`
  inside a conditional block — the established pattern for surfacing a
  mutation failure on this exact page, just not applied to the two start
  mutations.
- Effect: any `TRPCError` thrown by `insertRunningSimulation`,
  `checkAgainstAdminRanges`, or `assertWithinConcurrentObjectCeiling` —
  whatever the cause — reaches the browser only as a resolved-but-rejected
  tRPC call the user cannot see. `isPending` flips back to `false`, the
  button label reverts from "Starting…" to "Start", and nothing else
  happens. This is independently worth fixing regardless of the
  orphaned-row hypothesis: it converts every possible start failure, known
  or not-yet-discovered, into the exact "funny — it just doesn't work, no
  idea why" experience reported.

### No startup reconciliation for the server-owned run registry

- `src/server/simulation/server-run-registry.ts:144-154` — `registry` is a
  `Map<number, LiveRun>`. It is seeded once from `globalForRegistry` (a
  `globalThis` property), and only re-attached to `globalThis` when
  `process.env.NODE_ENV !== "production"` — meaning in production the
  `globalThis` caching has no effect anyway (a fresh process always starts
  with an empty `Map`, which is correct there; the guard exists purely to
  survive dev-mode module reloads without creating duplicate intervals).
- No file under `src/server/` contains logic that runs at process startup
  and queries `simulationRuns` for `status: "running"` rows to either
  resume them or mark them `stopped`. Searched for `orphan`,
  `recoverRun`, `reconcile.*running`, and "on startup"/"startup clean" across
  `src/server/simulation/server-run-registry.ts` and `src/server/db/index.ts`
  specifically (the two files most likely to own such a pass) — the only
  match was the HMR-survival comment cited above, which is about the
  opposite problem (avoiding orphaning *during* dev, not reconciling after
  a real restart).
- `insertRunningSimulation`'s running-row count
  (`src/server/api/routers/simulation.ts:284-293`) is a pure `COUNT(*)`
  against the database, with no join or cross-check against which run IDs
  the in-memory `registry` actually holds. A DB row can say `status:
  "running"` while no process anywhere is ticking it, and this check cannot
  tell the difference.

### Production's deploy mechanism destroys the registry on every push

- `context/deployment/deploy-plan.md:15` — the auto-deploy script run over
  SSH on every push to `master` is `git pull --ff-only && docker compose
  build app && docker build --target builder ... && docker run ... drizzle-kit
  migrate && docker compose up -d`. `docker compose build app` produces a
  new image on every deploy (the application code changed), so `docker
  compose up -d` recreates the `app` container rather than merely
  restarting the existing one — the Node process, and with it the
  in-memory `registry` Map, is fully destroyed and replaced.
- `context/deployment/deploy-plan.md:36` confirms `simulationRuns`' backing
  SQLite file survives a container restart (bind-mount persistence,
  verified directly on the VPS) — so a `status: "running"` row present at
  deploy time is not cleared by the deploy; it is carried forward verbatim
  into the new process, which has no record of it ever having existed.
- This session's own git history shows at least 8 separate pushes to
  `master` between 2026-11-17 16:54 UTC and 18:08 UTC (`git log
  --oneline --since="2026-11-17 16:50"` against this repository), each of
  which re-ran `.github/workflows/deploy.yml`'s `deploy` job
  (`gh run list --workflow="Deploy to VPS"`, inspected directly in this
  session) and therefore each of which recreated the production container.

## Code References

- `src/app/simulation/page.tsx:33-51` — UI default `useState` values for every start parameter.
- `src/app/simulation/page.tsx:140-211` — `buildStartInput`, the shared clamping logic for both start paths.
- `src/app/simulation/page.tsx:212-245` — `startServerMutation`/`startRun` definitions, no `onError`.
- `src/app/simulation/page.tsx:311-314` — the sibling pattern (`savePauseMutation.error` rendered) that the start mutations lack.
- `src/server/api/routers/simulation.ts:241-264` — `checkAgainstAdminRanges`.
- `src/server/api/routers/simulation.ts:277-300` — `insertRunningSimulation`'s per-user `MAX_PARALLEL_RUNS` check.
- `src/server/api/routers/simulation.ts:361-369` — `start` procedure.
- `src/server/api/routers/simulation.ts:374-421` — `startServer` procedure, including its own `assertWithinConcurrentObjectCeiling` call and rollback-on-failure handling.
- `src/server/simulation/run-slots.ts:4` — `MAX_PARALLEL_RUNS = 4`.
- `src/server/simulation/server-run-registry.ts:144-154` — the in-memory registry and its dev-only `globalThis` cache.
- `context/deployment/deploy-plan.md:15` — the production deploy script.
- `context/deployment/deploy-plan.md:36` — SQLite bind-mount persistence confirmation.

## Architecture Insights

- This codebase's established pattern for a mutation failure is to render
  `<mutation>.error.message` conditionally next to the triggering control
  (`savePauseMutation` at line 311). The two start mutations are the
  exception, not a deliberate design choice — nothing in the surrounding
  code or `context/changes/**` comments explains why they were left out.
- The `globalThis`-cached registry pattern exists specifically to solve a
  *different* problem (Next.js dev-mode module reloads creating duplicate
  interval closures over stale Map instances) and was never intended to —
  and does not — solve production process-restart recovery. The comment at
  `server-run-registry.ts:144-146` is explicit that the guard is scoped to
  non-production.
- The per-user `MAX_PARALLEL_RUNS` cap and the per-user
  `maxConcurrentObjectCount` cap are both pure DB-state checks with no
  liveness cross-check against the in-memory registry — this is consistent
  (both checks share the same blind spot), not an isolated oversight in one
  check only.

## Historical Context (from prior changes)

- `context/archive/2026-11-17-unwatched-run-tick-throttling/` (M-9's S-36)
  — the most recent change to `server-run-registry.ts`'s tick scheduling.
  Its own plan and review focus entirely on CPU fairness between
  concurrently-ticking runs; neither artifact mentions process-restart
  recovery or orphaned rows, confirming this is a pre-existing gap the
  throttling work did not introduce and was not scoped to address.
- No `context/changes/**` or `context/archive/**` folder was found (via
  `grep -rl` for "orphan", "restart", "recover" across those directories)
  discussing server-restart recovery for `simulationRuns.status`. This
  appears to be a genuinely new finding for this project, not a
  previously-identified-and-deferred issue.

## Related Research

- None found under `context/changes/**/research.md` or
  `context/archive/**/research.md` addressing this question.

## Open Questions

1. **Does the reporting user's production account actually have ≥4 rows
   stuck at `status: "running"` right now?** Owner: user (has VPS/production
   access this research session does not). Confirming this would turn the
   leading hypothesis into a certain root cause; a lower count would mean
   the orphaned-row mechanism is real but not (yet) the actual trigger, and
   the missing-error-display bug (finding #1) would need its own
   independent trigger investigated.
2. **Was the report based on the production deployment, or a local dev
   session?** The static-validation analysis in this research is grounded
   in the local dev database's current seeded values; if the report was
   against a local dev environment with different `admin_settings` values
   (e.g., a previously lowered `maxObjectCount` or `maxConcurrentObjectCount`
   from earlier ad hoc testing), that would be a simpler, unrelated
   explanation worth ruling out first. Owner: user.
3. **Should orphan reconciliation resume a stuck run, or just mark it
   `stopped`?** Resuming is not realistically possible — the entire live
   tick state (boid/predator positions, velocities, per-tick history) lived
   only in the destroyed process's memory, never persisted per-tick. The
   only recoverable action is marking the row `stopped` (with no score,
   since no `history`/final tick data exists to compute one from) so it
   stops consuming a `MAX_PARALLEL_RUNS` slot. This research recommends
   stating that explicitly as a design decision for `/10x-plan`, not
   re-litigating whether resumption is possible.
