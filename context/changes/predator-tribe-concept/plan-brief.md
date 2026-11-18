# Predator Tribe Concept (F-10) — Plan Brief

> Full plan: `context/changes/predator-tribe-concept/plan.md`

## What & Why

Give predators a fully independent tribe system — their own count
(`predatorFlockCount`), their own `flockId` space, and their own per-tribe
config (`PredatorTribeConfig[]`) — mirroring what `per-tribe-behavior-weights`
(F-09) already built for boids. Along the way, fix a confirmed dead-code gap
(predator genetics inherit `maxSpeed`/`minSpeed` every generation but
`stepPredators` has never read them) and give predator tribes two new
genuinely-tunable fields: detection radius and capture-radius aggressiveness.

## Starting Point

Today predators silently reuse boids' *exact same* `flockCount`/
`tribeConfigs[]` — confirmed via direct code research, not assumed. There is
no independent predator-tribe concept anywhere in the codebase.
`PredatorGenes` is a hard alias of `BoidGenes`, and `reproducePopulation`/
`inheritGenes` are already fully generic across both species — no change
needed there. `stepPredators` has zero per-tribe awareness: fixed speed
constants, no detection-radius gate (scans every boid unconditionally), no
`rng` parameter.

## Desired End State

A run configures `predatorFlockCount` independently of boids' `flockCount`,
with its own `PredatorTribeConfig[]`. Predators spawn into these tribes via
the same contiguous-block split boids use. `stepPredators` now reads each
predator's own `genes.maxSpeed`/`genes.minSpeed` (replacing fixed
constants), gates targeting by its own tribe's detection radius (no target
in range → small random wander, not a frozen heading), and `applyPredation`
scales capture distance by the predator's own tribe's multiplier. Live-edit
parity with boids' tribe system. No new UI — verified via a direct registry
script.

## Key Decisions Made

| Decision | Choice | Why | Source |
|---|---|---|---|
| Tribe identity model | Fully independent predator tribes (own count, flockId space, config array) | Only model where "independently-evolving genetics" is actually independent; matches the roadmap Outcome text literally | User |
| F-10/S-42 boundary — genetics wiring | Fix `stepPredators`' dead `maxSpeed`/`minSpeed` read now, in F-10 | Without it, genetics-per-tribe is cosmetic (color/lifespan/mating only) — the exact "inherited but never read" bug class `lessons.md` already flags twice | User |
| F-10/S-42 boundary — new fields | Add 2 new predator-tribe fields (detection radius, capture multiplier) now, despite S-42's own stated scope overlap | User's explicit choice, against the plan's own recommendation to defer | User |
| F-10/S-42 boundary — UI | No new UI in F-10 | S-42's own Outcome explicitly owns "User configures a predator tribe's own behavior tuning" | User |
| Capture-aggressiveness mechanism | Capture-radius multiplier (not a steering-force multiplier) | User's explicit pick over the recommended steering-force option | User |
| Detection-radius gate behavior | Out of range → no target; in-range check replaces the existing unconditional scan | Makes the field behaviorally real, not config-only dead weight | User |
| Idle (no-target) behavior | Small random wander force (not "hold last heading") | User's explicit pick over the simpler drift-fallback recommendation; needs `rng` threaded into `stepPredators` for the first time | User |
| Admin-range posture for new fields | Mirror boids' exact convention — one shared range across all predator tribes | Zero new validation architecture; proven pattern | User |
| Cross-tribe predator mating | Unrestricted, same rule as boids | Zero change to `reproducePopulation`/`inheritGenes`, which are already fully generic | User |
| `predatorFlockCount` bounds | `[1, 8]`, default `1` | `min`/`default` of 1 reproduces today's single-undifferentiated-predator-tribe behavior exactly for any run that doesn't opt in; `max: 8` gives headroom beyond boids' own `[2,4]` | User |
| Live-edit scope | Add `applyLivePredatorTribeConfigs`/`updatePredatorTribeConfigs` now, even with no UI consumer yet | Completes engine-side parity with boids in one pass so S-42 only needs UI, not new engine mutations | User |
| Verification approach | Direct script against the registry/engine (no UI exists) | Matches this session's own `per-tribe-food-config` Phase 7 discipline; proves real behavioral divergence, not just stored config | User |

## Scope

**In scope:** `PredatorTribeConfig` type; independent `predatorFlockCount`/
`predatorTribeConfigs` schema + admin-range validation; predator spawning
reads the new independent config; `stepPredators` gains detection-radius
gating + idle wander + real `maxSpeed`/`minSpeed` wiring; `applyPredation`
gains capture-radius multiplier; full live-edit parity; a direct
verification script.

**Out of scope:** any new UI (deferred to S-42); predator genetic-diversity-
trend/analysis-view integration; any change to `reproducePopulation`/
`inheritGenes`; same-tribe mating restrictions; predator hunger/food
mechanics.

## Architecture / Approach

```
Spawn (Phase 2)                Per-tick (Phases 3-4)              Live-edit (Phase 5)
createInitialPredators    →    stepPredators reads               applyLivePredatorTribeConfigs
  reads predatorTribeConfigs     genes.maxSpeed/minSpeed            (wholesale replace, mirrors
  [flockId], seeds genes         + predatorTribeConfigs             applyLiveTribeConfigs exactly)
                                 [flockId].detectionRadius      ↓
                                 (gate targeting; no target  →  updatePredatorTribeConfigs
                                 → rng-driven wander)            (router mutation, mirrors
                              applyPredation reads                updateTribeConfigs)
                                 predatorTribeConfigs
                                 [flockId].captureRadiusMult
```

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Data model & schema | `PredatorTribeConfig`, new admin-range entries, zod schema, length-check | Low — pure additive plumbing, no behavior change |
| 2. Independent spawning | Predators split across their own tribes, independent of boids' | Low — same `splitCountAcrossFlocks` helper already proven for boids |
| 3. Detection radius & idle wander | First genuinely new predator behavior — a real targeting boundary | Medium — new `rng`-driven wander force needs careful magnitude tuning so it looks idle, not erratic, and doesn't break existing seeded-test determinism |
| 4. Genes wiring & capture aggressiveness | Genetics finally have real effect; capture distance becomes tunable | Low-medium — touches two already-well-tested functions (`stepPredators`, `applyPredation`), straightforward per-predator lookup |
| 5. Live adjustment | Full parity with boids' live-edit path | Low — direct structural mirror of `applyLiveTribeConfigs`/`updateTribeConfigs` |
| 6. Verification | Direct script proving every field behaviorally real | Medium — no UI to lean on; must design the script carefully to actually observe behavior change, not just stored config, per this project's own recurring lesson |

**Prerequisites:** None (F-10 has no roadmap prerequisites).
**Estimated effort:** ~1-2 sessions across 6 phases — comparable in shape to
F-09's own 9-phase effort, tightened by skipping the UI phase.

## Open Risks & Assumptions

- The `detectionRadius` default (`200`, matching this project's own
  `xyArea`/`zDepth` defaults) is a close-but-not-byte-identical
  approximation of today's unconditional-scan behavior at default config —
  a predator from beyond that radius would previously still get targeted
  and now wouldn't. Explicitly documented as an accepted, small, default-
  config behavior change rather than silently glossed over.
- The wander-force magnitude (Phase 3) has no existing precedent in this
  codebase to copy exactly — the plan points at `mutationMagnitude`-style
  small-jitter scales as a reference, but the implementer will need to
  pick and justify an actual number.
- `separation`/`alignment`/`cohesion` fields on `PredatorTribeConfig` are
  explicitly inert (seeded into genes, never read by any predator
  behavior) — carried over only because `PredatorGenes = BoidGenes` still
  requires every heritable field populated at spawn. Flagged clearly in
  Phase 1 so this isn't mistaken for an oversight later.

## Success Criteria (Summary)

- A run with independently-configured predator tribes spawns predators
  split per `predatorFlockCount`, not boids' `flockCount`.
- Each predator-tribe field (detection radius, capture multiplier,
  maxSpeed/minSpeed) produces a measurable, directly-verified behavior
  difference — not just a stored config value.
- Live-editing a predator tribe changes the next tick's behavior.
- Full test suite passes; a direct verification script proves every
  Phase 6 manual-check item.
