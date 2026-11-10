# Deterministic Seeded-PRNG Strategy (F-02) — Plan Brief

> Full plan: `context/changes/deterministic-seed-strategy/plan.md`

## What & Why

swarm-arena's core product premise is that two runs with identical parameters and seed must produce identical scores — otherwise variants can't be meaningfully compared. No randomness source exists yet in the codebase, and S-01 (the north star slice) will need one immediately for initial boid placement. This slice establishes that one source now, before any ad-hoc `Math.random()` calls can spread and need retrofitting later.

## Starting Point

Zero simulation code exists. The only `Math.random()` call anywhere in the repo is an unrelated dev-mode latency delay in the T3 scaffold's tRPC timing middleware. No PRNG dependency is installed.

## Desired End State

A `createRng(seed)` function exists that any future simulation code can call to get a deterministic, `Math.random()`-shaped random source. Calling it twice with the same seed and the same number of draws always produces the same sequence.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| PRNG approach | Self-contained mulberry32, zero dependency | Guarantees the output sequence for a seed can never change via an upstream library version bump — directly serves the hard "identical seed → identical score" NFR. | Plan |
| API shape | `createRng(seed) => () => number`, mirrors `Math.random()` | Nothing consumes it yet; a minimal drop-in-replacement shape avoids guessing at methods S-01 hasn't asked for. | Plan |
| Location | `src/server/simulation/rng.ts` | New sibling to the existing `server/{api,auth,db}` folders — signals server-side simulation domain logic, matching the PRD's server-only simulation design. | Plan |
| Verification | Automated Vitest test, not manual | Cheaply tests the one property this slice exists for, without needing any simulation code to exist yet. | Plan |

## Scope

**In scope:** one new RNG module, one new test file proving determinism.

**Out of scope:** wiring the RNG into any simulation logic (nothing exists yet — that's S-01), distribution helpers beyond uniform floats, any PRNG library dependency.

## Architecture / Approach

A single pure function, `createRng(seed) => next()`, implementing the public-domain mulberry32 algorithm inline. No class, no state beyond the closure, no dependency. Future simulation code imports `createRng` and calls `next()` wherever it would otherwise call `Math.random()`.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. RNG module and determinism test | `src/server/simulation/rng.ts` + passing Vitest proof of same-seed/cross-seed behavior | Low — self-contained, no integration points yet to break |

**Prerequisites:** none (F-02 has no roadmap prerequisites).
**Estimated effort:** well under one session — a single small file plus a test.

## Open Risks & Assumptions

- Assumes S-01 (not yet planned) will actually import and use `createRng` rather than reaching for `Math.random()` directly — this slice establishes the convention but can't enforce it without a lint rule, which is out of scope here.

## Success Criteria (Summary)

- `createRng(seed)` called twice with the same seed produces identical sequences.
- Different seeds produce different sequences.
- All automated gates (typecheck, check, test, build) pass.
