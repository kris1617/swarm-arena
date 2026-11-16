---
date: 2026-11-16T22:13:59+01:00
researcher: Claude Sonnet 5
git_commit: fe3dc418937b1fd8bff7aeda1a149d7634f13def
branch: master
repository: swarm-arena
topic: "Rollout Phase 7 — functional regression audit on newest shipped slices (S-27–S-35)"
tags: [research, codebase, testing, live-parameter-adjustment, genetic-diversity-trend, corpus]
status: complete
last_updated: 2026-11-16
last_updated_by: Claude Sonnet 5
---

# Research: Functional regression audit on newest shipped slices (S-27–S-35)

**Date**: 2026-11-16T22:13:59+01:00
**Researcher**: Claude Sonnet 5
**Git Commit**: fe3dc418937b1fd8bff7aeda1a149d7634f13def
**Branch**: master
**Repository**: swarm-arena

## Research Question

For roadmap slices S-27 through S-35 (the live-parameter-adjustment family and
the corpus/analytics infrastructure), which user-visible behaviors currently
lack automated regression-test coverage, specifically against the documented
failure mode in `context/foundation/lessons.md` ("UI accepts input is not
feature verified"): a value is correctly written and displayed, but the
system's actual downstream behavior is never confirmed to change as a result?

## Summary

Every one of the 7 currently-live-adjustable fields across S-27/S-28/S-31
(`foodRegenRate`, `protectionThreshold`, `energyThreshold`, `mutationChance`,
`mutationMagnitude`) has thorough write/round-trip test coverage but **zero**
automated test that applies a live patch and then executes a tick/reproduction
cycle to assert the simulation's actual decision output changed. This is
exactly the S-27 failure mode the lesson documents, and it would still slip
through undetected today in both the server-owned and client-staged paths.

S-29 (live-crossbreeding-toggle) has genuine behavioral-effect coverage for
the underlying `reproducePopulation` function, but no test wires a live toggle
through an actual tick execution, and the client-staged path's only test mocks
the tick function entirely — reproducing the lesson's failure shape precisely.

S-30 (live-boid-count-adjustment, server-owned only) has solid behavioral
coverage for growth/shrink mechanics (centroid placement, lowest-energy
removal) but newly-spawned individuals are never asserted for correct
`genes`/`energy`/`age`/`flockId` initialization — a malformed-placeholder
regression would pass undetected.

S-32 (genetic-diversity-trend) is the single highest-priority gap: the entire
chart feature — the user-visible reason these slices exist — has zero tests
verifying the computed per-tick series is behaviorally correct (flat for a
zero-variance population, rising under injected mutation). Every existing test
either mirrors the same production function it's checking, or only confirms
plumbing/forwarding. Dual-path and pause/resume-snapshot coverage are both
solid, by contrast.

S-33/S-34/S-35 (corpus generation + the two corpus-driven test suites) are
themselves test infrastructure and are in good health: the corpus is 20 real,
non-degenerate gzipped run fixtures, and the two consuming test suites iterate
real corpus data rather than a stub.

## Detailed Findings

### Live-parameter-adjustment family (S-27, S-28, S-31)

Current live-adjustable field set, post-S-31 correction: `foodRegenRate`,
`protectionThreshold` (immediate effect), `energyThreshold`, `mutationChance`,
`mutationMagnitude` (future-offspring-only effect).

| Field | Write/mutation test | Behavioral-effect test | Applies to |
|---|---|---|---|
| `foodRegenRate` | `src/server/simulation/server-run-registry.test.ts:410-416`; `src/server/api/routers/simulation.test.ts:2034` (changelog persistence) | **MISSING** | server-owned only (client-staged has no equivalent either way) |
| `protectionThreshold` | `src/server/api/routers/simulation.test.ts:2309-2310`; `server-run-registry.test.ts:69-71` | **MISSING** | server-owned only |
| `energyThreshold` | `simulation.test.ts:2924-2929` (out-of-range patch, warning); `server-run-registry.test.ts:419` | **MISSING** — the plan's own manual-only check ("set `energyThreshold` far above any boid's energy; confirm no further reproduction") was never converted to an automated test | both |
| `mutationChance` | `simulation.test.ts:276-308` (range validation) | **MISSING** | both |
| `mutationMagnitude` | Extensive, e.g. `server-run-registry.test.ts:392,409-419,433-440,502-518,740,829-852,926` | **MISSING** — the plan's own deterministic manual check (`mutationMagnitude=0` → zero-deviation offspring genes) stayed a *manual* Progress item (S-31 plan.md 2.6; S-28 plan.md 2.6), never automated | both |

Every automated test for these 5 fields stops at "the patched value is
readable back from `run.params`/`liveParams`/the changelog." `boids.test.ts`
and `single-run-lifecycle.test.ts` unit-test these params' effects on the
underlying pure functions in isolation, but none of those tests go through
`applyLiveParams`/`updateRunParams` — so a regression where a field becomes
wired-but-dead again (the exact S-27 bug) would not be caught by them.

### Live-crossbreeding-toggle (S-29)

| Path | Data-mutation test | Behavioral-effect test | Note |
|---|---|---|---|
| Server-owned | `server-run-registry.test.ts:464-467` | `src/server/simulation/boids.test.ts:838-864` — calls `reproducePopulation` directly with the flag true/false, asserts population length 3 vs 2 (genuine downstream-behavior assertion) | Exercises `reproducePopulation` in isolation, not `applyLiveParams` → tick → `reproducePopulation` end-to-end |
| Client-staged | `src/app/simulation/_components/simulation-canvas.test.tsx:577-605` — asserts the mocked `computeSingleRunTick` call receives `crossbreedingEnabled: false` | **MISSING** — `computeSingleRunTick` is mocked in this test file, so the assertion only proves the value reaches the call site, not that reproduction behavior actually changes | Precisely the lesson's failure shape |

### Live-boid-count-adjustment (S-30, server-owned only — confirmed against plan.md; no client-staged equivalent exists for population count)

| Data-mutation test | Behavioral-effect test | Gap |
|---|---|---|
| `server-run-registry.test.ts:531-632` | Partial — growth (`:531-580`) asserts added boids land near the pre-growth centroid (real geometric effect); shrink (`:613-660`) asserts the lowest-energy individuals are the exact ones removed (identity-based oracle) | Newly-added boids/predators are never asserted for correct `genes`, `energy` (should be `INITIAL_ENERGY`), `age` (should be 0), or `flockId` — a malformed-placeholder regression would pass every current test |

### Genetic-diversity-trend (S-32)

- **Per-tick series correctness**: not tested against a constructed oracle.
  `src/server/simulation/single-run-lifecycle.test.ts:143-164` asserts
  `firstResult.geneticDiversitySamples[0] === computeGeneticDiversity(firstResult.boids.map(b => b.genes))`
  — a mirror-implementation test (recomputes the expected value with the same
  function the production code calls), not an independent behavioral check.
  `src/server/simulation/boids.test.ts:1168-1199` unit-tests the pure
  `computeGeneticDiversity` function in isolation (`[]`→0, identical genes→0,
  spread>tight) but never the per-tick sample *array* that actually gets
  persisted and charted. No test feeds a known-0-variance or known-mutating
  population through `computeSingleRunTick` across multiple ticks and asserts
  the resulting series is flat or rising.
- **Dual-path coverage**: both paths have shape/plumbing tests, neither has
  behavior tests. Server-owned: `server-run-registry.test.ts:165-188`
  (persisted array matches live array at finish). Client-staged:
  `simulation-canvas.test.tsx:194-223` — asserts only `length > 0` and that the
  stop-mutate payload forwards the same array object by reference; never
  independently checks the values.
- **Pause/resume snapshot path**: solidly covered and correctly scoped to the
  S-25 bug class. `server-run-registry.test.ts:862-900` round-trips
  `snapshotServerRun`→`resumeServerRun`; `server-run-registry.test.ts:1111-1151`
  directly tests resuming a snapshot with the key *deleted* (matching real
  legacy JSON, not just `undefined`) and confirms a post-resume tick doesn't
  throw. Note: a grep of `context/foundation/lessons.md` for "S-25" found no
  matching heading — the citation lives in test comments/plan prose only; this
  does not affect the finding's validity but is worth a corrective note if the
  cookbook (§6) later references "lessons.md's S-25 rule" by name.
- `buildDiversityChartData` (`src/app/runs/[runId]/page.test.ts`) is correctly
  unit-tested for undefined/empty/mapped cases, but this is pure plumbing
  (tick-zip), not a behavior check.

### Corpus infrastructure health (S-33, S-34, S-35) — brief, not deep-audited

- Corpus generation has its own tests: `src/server/simulation/corpus-fixture.test.ts`,
  `src/server/api/routers/corpus-db-fixture.test.ts`.
- The corpus itself (`context/fixtures/parameter-sweep-corpus/`) is 20 real
  gzipped run files (27–55 KB each) plus `index.csv` — not a degenerate
  single-row fixture.
- S-34 (`src/server/simulation/parameter-suggestion.corpus.test.ts`) and S-35
  (`simulation.getRunAnalysis.corpus.test.ts`,
  `simulation.getRunsComparison.corpus.test.ts`,
  `simulation.listLeaderboard.corpus.test.ts`) iterate the real 20-run corpus,
  e.g. `getRunAnalysis.corpus.test.ts:73-74` asserts range bounds across every
  corpus run. This is coverage-of-non-crash/range-validity across real data —
  legitimate infrastructure health, though not oracle-verified correctness
  per se.

## Code References

- `src/server/simulation/server-run-registry.ts` / `.test.ts` — `applyLiveParams`, `adjustLivePopulation`, snapshot/resume round-trip
- `src/server/api/routers/simulation.ts` / `.test.ts` — live-param patch endpoint, changelog persistence
- `src/server/simulation/boids.test.ts:838-864,1168-1199` — `reproducePopulation` crossbreeding-guard test, `computeGeneticDiversity` unit tests
- `src/server/simulation/single-run-lifecycle.test.ts:143-164` — mirror-implementation diversity-series test
- `src/app/simulation/_components/simulation-canvas.test.tsx:194-223,577-605` — client-staged plumbing tests (both mock the tick function)
- `src/app/runs/[runId]/page.test.ts` — `buildDiversityChartData` plumbing tests

## Architecture Insights

Across every audited slice, this project's test suite is thorough at the
**data/plumbing layer** (value round-trips through storage, display, and
forwarding between functions) but has a consistent, repeated blind spot at the
**behavioral layer**: no test applies a live mutation and then drives an
actual tick/reproduction cycle to observe the mutation's real downstream
effect. This is not isolated to S-27 (the slice the lesson was written about)
— it is the dominant pattern across every live-adjust/toggle feature shipped
since, including ones implemented *after* the lesson was recorded (S-29, S-30
partially, S-32). The pure functions themselves (`reproducePopulation`,
`computeGeneticDiversity`, growth/shrink mechanics) are well-unit-tested in
isolation; the gap is specifically in the *wiring* between the live-patch
entry point and those functions' invocation during a real tick.

## Historical Context (from prior changes)

- `context/foundation/lessons.md` ("UI accepts input is not feature
  verified") — the originating incident (S-27) and the rule this audit was
  designed to re-check compliance with.
- `context/archive/2026-11-15-correct-live-parameter-field-set/plan.md` (S-31)
  — the fix for S-27's original bug; its own manual-verification Progress item
  2.6 was never converted to an automated test, which is itself a recurrence
  of the same pattern one level down.
- `context/archive/2026-11-15-live-boid-count-adjustment/plan.md` (S-30) —
  confirms server-owned-only scope for population-count adjustment.
- `context/archive/2026-11-15-genetic-diversity-trend/plan.md` (S-32) —
  required dual-path parity and pause/resume safety explicitly; both were
  delivered, but the series' own correctness was not.

## Related Research

- `context/foundation/test-plan.md` §2 (Risk Map) — this audit's scope was
  requested as Phase 7 ("Functional regression audit on newest shipped
  slices"), opened via `/10x-test-plan --refresh` on 2026-11-16.

## Open Questions

- None blocking. The gap pattern is consistent and well-evidenced across all
  3 research areas; `/10x-plan` can sequence fixes directly from this
  document without further investigation.
