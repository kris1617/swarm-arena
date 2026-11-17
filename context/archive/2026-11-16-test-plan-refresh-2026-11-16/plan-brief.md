# Functional regression audit on newest shipped slices — Plan Brief

> Full plan: `context/changes/test-plan-refresh-2026-11-16/plan.md`
> Research: `context/changes/test-plan-refresh-2026-11-16/research.md`

## What & Why

Every live-adjust/toggle feature shipped since S-27 (live-parameter-adjustment)
has thorough write-level test coverage but zero test that confirms the
mutation actually changed the simulation's behavior — only that a stored
value round-tripped correctly. This is the exact failure mode
`context/foundation/lessons.md` documents from S-27's own bug ("UI accepts
input is not feature verified"), and research confirmed it recurs across
every feature shipped since, including ones built after the lesson was
recorded.

## Starting Point

6 live-adjustable fields/toggles (`foodRegenRate`, `protectionThreshold`,
`energyThreshold`, `mutationChance`, `mutationMagnitude`,
`crossbreedingEnabled`) flow through one router procedure
(`simulation.updateRunParams`) with solid write-level tests. Boid-count
growth (`adjustLivePopulation`) correctly places/removes individuals but
never checks their `energy`/`age`/`genes` initialization. The
genetic-diversity-trend chart's per-tick series has only a mirror-implementation
test, never an independent oracle.

## Desired End State

Every one of these 5 gaps has an automated test that drives a real tick and
asserts the actual downstream effect — a regression of the S-27 failure mode
(value written, never read at decision time) would now fail a test instead
of shipping silently.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| Scope | Fix all 5 gaps in one phase | Same fix pattern repeats across all 5; doing them together avoids re-deriving it later | Plan (user-confirmed) |
| Test-helper reuse | Build one shared "patch → tick → assert" helper | `updateRunParams` covers all 6 fields through one procedure, so one helper serves all of Phase 1 | Plan (user-confirmed) |
| Boid-init strictness | Exact-value match (`energy === INITIAL_ENERGY`, `age === 0`, well-formed `genes`) | Catches the actual malformed-placeholder failure mode; a range check would miss it | Plan (user-confirmed) |
| Test layer (server-owned) | Through the real tRPC router via `createCaller` | Matches this suite's existing integration-test convention; catches a regression anywhere in the patch→tick wiring | Plan (user-confirmed) |
| Client-staged test layer | Direct `computeSingleRunTick` calls, no mocking | Already the established pattern in `single-run-lifecycle.test.ts`; needs no new scaffolding | Research |

## Scope

**In scope:** behavioral-effect tests for all 6 live-param/toggle fields
(both execution paths), boid-count-growth initialization assertions,
genetic-diversity-series oracle test, a cookbook entry documenting the
pattern.

**Out of scope:** pause/resume-path extension for S-32 (already covered for
crash-safety), a client-staged equivalent for boid-count adjustment (no such
code path exists), any general-purpose test framework beyond the one
narrowly-scoped shared helper.

## Architecture / Approach

Server-owned tests drive a real tick via `createCaller` + `vi.advanceTimersByTimeAsync`
(the existing pattern in `server-run-registry.test.ts`). Client-staged tests
call the pure `computeSingleRunTick` directly (the existing pattern in
`single-run-lifecycle.test.ts`) — no router, no component, no mocking needed
for either path.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Shared helper + server-owned behavioral tests | 6 behavioral tests (5 fields + crossbreeding), server-owned path | Fixture setup (energy/food levels) must actually straddle each threshold being tested |
| 2. Client-staged behavioral tests | Same 6, client-staged path | None significant — direct function calls, no new infra |
| 3. Boid-count-growth initialization test | Exact-value assertions on new individuals | `INITIAL_ENERGY` export is a 1-line change but touches a module other phases also read |
| 4. Genetic-diversity-series oracle test | Flat-vs-rising series assertions against constructed populations | Must avoid recreating the existing mirror-test anti-pattern |
| 5. Cookbook update | New §6.7 pattern entry; Phase 7 marked complete | None |

**Prerequisites:** None — all needed test infrastructure already exists in this codebase.
**Estimated effort:** 5 phases, each independently verifiable; no cross-phase blocking dependencies except Phase 5 depending on 1-4 being complete.

## Open Risks & Assumptions

- Assumes the fixture populations constructed for Phase 1's tests (e.g. a
  flock sized to straddle `protectionThreshold`) can be built with this
  project's existing test-fixture helpers without new scaffolding — if not,
  a phase may need a small fixture-builder addition not currently scoped.
- Assumes `INITIAL_ENERGY`'s export (Phase 3) has no other consumers relying
  on its current non-exported (module-private) status — unlikely, since
  exporting a constant is additive, but worth a quick grep during
  implementation.

## Success Criteria (Summary)

- All 5 research-identified gaps have passing automated behavioral tests.
- A deliberate break of each tested behavioral wiring (verified per-phase via
  the standard break-check) causes the corresponding new test to fail.
- `context/foundation/test-plan.md` §3 Phase 7 is marked `complete` and §6
  gains a reusable pattern entry for future live-adjust/toggle features.
