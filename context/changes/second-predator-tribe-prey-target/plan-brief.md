# Second predator tribe with configurable prey target — Plan Brief

> Full plan: `context/changes/second-predator-tribe-prey-target/plan.md`

## What & Why

S-43 is the roadmap's own flagged highest-risk item — "the most novel piece in this milestone,
with no precedent in the Lua reference or anywhere in the current codebase." Predators today can
only ever hunt boids; this change lets a predator tribe optionally also hunt other predator
tribes (never its own), with the outcome feeding a new 6th scoring factor. Open Roadmap Question
#10 already resolved that inter-predator predation should affect scoring; this plan resolves the
exact shape of that factor and every other open design question research surfaced.

## Starting Point

`stepPredators`/`applyPredation` scan and capture only boids; predators die only from natural
lifespan expiry. `computeScore` is a flat 5-factor product with no predation-aware signal beyond
raw combined headcount in one existing factor. No comparability-flag precedent exists except a
sticky write-once boolean pattern (`wasEverThrottled`/`wasEverFoodImbalanced`) read through
`ScoredRun`. S-42 already built the predator-tribe array/UI scaffolding this change slots into.

## Desired End State

A user configures a second predator tribe's prey target to "boids and predators"; that tribe
hunts both boids and the first predator tribe's members (never its own), respecting
`protectionThreshold` as an extinction floor; the run's score includes a new factor reflecting
how balanced the two predator tribes ended up, with every existing/default-configured run scoring
that factor as a neutral 1.0.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Reciprocal protection | Prey target controls hunting only, never grants protection from being hunted | Simplest model — a per-tribe setting about what a tribe does, not what's done to it | Plan |
| Same-tribe safety | Predators never hunt their own tribemates | Nothing in the roadmap's "hunt accordingly" language suggests self-cannibalization | Plan |
| Capture mechanic | Reuse `CAPTURE_RADIUS`/`captureRadiusMult` exactly as boid capture | Zero new mechanic to design or tune for the riskiest item in the milestone | Plan |
| Scoring shape | New 6th factor, not folded into survival | Matches this project's own S-25 precedent (areaPopulationDensity shipped as a clean new factor) | Plan |
| Factor meaning | Predator-tribe population balance ratio (1.0 = balanced) | Fits every other factor's "reward a healthy, sustained ecosystem" character, not raw conquest | Plan |
| Single-tribe behavior | Factor always applies, defaults to neutral 1.0 with <2 tribes | Zero score change for any existing/default-configured run | Plan |
| Protection floor | `protectionThreshold` reused as a per-tribe extinction floor | One mental model instead of two separate protection concepts | Plan |
| Extinction handling | One predator tribe going extinct doesn't end the run | Minimal change to existing stop conditions; extinction is valid outcome data | Plan |
| UI scope | Both start-form and live-edit panel | Full parity with every other predator-tribe field after S-42 | Plan |
| Scope cut line | None — everything ships together | User explicitly overrode the live-edit-is-the-cut recommendation | Plan |
| New field default | `"boids"` | Matches today's actual behavior exactly — zero behavior change | Plan |
| Analysis view | Out of scope | Mirrors F-10's own explicit precedent of deferring predator analysis-view work | Plan |
| UI primitive | `Select`, not `Switch` | `preyTarget` is a named 2-value enum, not a boolean; codebase already has this exact precedent | Plan |
| Verification depth | Dedicated behavioral tests + end-to-end script | Matches this session's own established, proven discipline for every predator-tribe change | Plan |

## Scope

**In scope:**
- `PredatorTribeConfig.preyTarget` field + `stepPredators`/`applyPredation` cross-tribe targeting
  and capture, with same-tribe exclusion and a per-tribe protection floor.
- A new 6th scoring factor (predator-tribe population balance) with full S-25-style threading and
  a sticky comparability flag.
- UI exposure in both the start-form and live-edit panel.
- Dedicated behavioral tests and an end-to-end verification script.

**Out of scope:**
- Reciprocal protection, same-tribe hunting, a new/separate capture-radius field, a new
  run-ending extinction stop condition, analysis-view integration, a score-formula-version flag.

## Architecture / Approach

Five dependency-ordered phases: the engine mechanic (isolating the riskiest piece — a breaking
`applyPredation` return-type change — early and independently gated), the schema/validation layer,
the cross-cutting scoring thread (widest blast radius, ~6 files end-to-end), UI in both places,
then verification.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Engine core | Cross-tribe targeting/capture, protection floor | `applyPredation`'s breaking return-type change ripples into `runTick` and every direct test caller |
| 2. Schema/validation | `preyTarget` exposed via one shared zod schema | Low risk — mechanical, mirrors S-42's own Phase 2 exactly |
| 3. Scoring | New 6th factor + comparability flag | Widest blast radius — 6-file S-25-style thread, including a DB migration |
| 4. UI | `Select` control, start-form + live-edit | New UI primitive choice (Select vs. the established Switch pattern) must be gotten right |
| 5. Verification | Behavioral tests + end-to-end script | None significant — pure verification |

**Prerequisites:** S-42 (per-tribe-predator-config) and F-10 (predator-tribe-concept), both
archived and shipped — confirmed done.
**Estimated effort:** ~5 phases; Phase 3 is the largest single phase (6-file thread + migration).

## Open Risks & Assumptions

- `computeScore`'s full caller list beyond the 3 known production/test sites is unconfirmed until
  Phase 3 greps `scripts/corpus/`/`scripts/perf-baseline.ts` explicitly — `per-tribe-predator-config`
  found exactly this kind of miss in its own corpus scripts.
- Phase 2's fixture file list is derived from precedent (S-42's own Phase 2 touched-file list for
  an analogous new `PredatorTribeConfig` field) and may not be fully exhaustive — Phase 2 greps
  for every `PredatorTribeConfig`-shaped literal before considering itself complete.

## Success Criteria (Summary)

- A second predator tribe set to "boids and predators" visibly hunts the first tribe, never its
  own members, and respects the protection floor.
- The run's score includes the new factor, correctly neutral (1.0) for any single-predator-tribe
  run.
- A live mid-run prey-target change via the UI actually changes next-tick capture behavior, not
  just the stored config.
