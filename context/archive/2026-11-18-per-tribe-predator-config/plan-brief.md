# Per-tribe predator config — Plan Brief

> Full plan: `context/changes/per-tribe-predator-config/plan.md`

## What & Why

S-42's roadmap outcome is "user configures each predator tribe's own behavior tuning
independently, mirroring boid flocks' existing crossbreeding system, scoped per tribe." Research
found that premise only half-true: F-10 already built the full predator-tribe *engine* (types,
admin ranges, DB persistence, live-edit mutation) with zero UI, but boids' own crossbreeding is
a single global flag today — "scoped per tribe" doesn't exist yet for either species. This plan
builds the predator-tribe UI *and* the genuinely-new per-tribe crossbreeding mechanic, for both
species symmetrically.

## Starting Point

F-10 left `PredatorTribeConfig` (8 fields) fully wired server-side with no UI consumer.
`crossbreedingEnabled` is one boolean per run, gating any cross-flock mating pair, with a
scalar live-edit path (`updateRunParams` + a `<Switch>` in two components). No UI anywhere
calls `updateTribeConfigs`/`updatePredatorTribeConfigs`, though both exist and are tested.

## Desired End State

Before starting a run, a user picks predator tribe count and tunes each tribe's speed,
perception, capture aggressiveness, mate preference, and crossbreeding permission in a tab
panel identical in shape to the existing boid tribe tabs. The same per-tribe crossbreeding
toggle replaces boids' old global switch. During an active run, a new live-edit panel lets the
user adjust any tribe (boid or predator) — including flipping crossbreeding — and the engine
reflects it on the next tick.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Crossbreeding scope | Build per-tribe crossbreeding now, in this change | User chose to fully deliver the roadmap's stated outcome rather than descope it | Plan |
| Species scope | Both boids and predators get per-tribe crossbreeding | Avoids a lasting asymmetry between the two species' config shape | Plan |
| Toggle semantics | Per-tribe "allow mating across tribe lines" | Directly generalizes the existing global flag's real behavior | Plan |
| Two-tribe rule | Cross-tribe mating requires BOTH tribes to allow it | Symmetric, predictable — an opt-out genuinely protects that tribe | Plan |
| Flag migration | Remove the global `crossbreedingEnabled` column/field entirely | One clear mechanism; no dead global-vs-per-tribe interaction to document | Plan |
| New field default | `true`, matching today's global default | Zero behavior change for existing/default-configured runs | Plan |
| Start-form UI | Mirror the boid tribe tab pattern exactly | Zero new UI architecture for the start-time config side | Plan |
| Inert fields (`separation`/`alignment`/`cohesion`) | Hidden from the predator UI | They do nothing for predators today; showing them would mislead the user | Plan |
| `maxSpeed`/`minSpeed` admin range | Add a real range for predators now | Closes a real gap, even though boids still lack the equivalent | Plan |
| Live-edit UI | Build a new panel now, for both species | Gives the first UI consumer to mutations that have existed, unused, since F-10 | Plan |
| Scope cut line | None — all phases are must-have | User explicitly rejected a fallback scope reduction | Plan |
| Old scalar live-edit path | Fully removed (not left dead) | Matches this project's own precedent of deleting rather than orphaning constants | Plan |

## Scope

**In scope:**
- Per-tribe `crossbreedingEnabled` on `TribeConfig`/`PredatorTribeConfig` (both species), with
  the both-tribes-must-allow cross-tribe gate.
- Removal of the global `crossbreedingEnabled` column, schema fields, and scalar live-edit path.
- New admin range for predator `maxSpeed`/`minSpeed`.
- Start-form predator-tribe count control + tab panel (6 of 8 fields shown).
- New per-tribe live-edit panel (boid + predator), the first UI consumer of
  `updateTribeConfigs`/`updatePredatorTribeConfigs`.
- Full fixture/test updates across ~12 affected test files.

**Out of scope:**
- A second predator tribe via the UI, prey-target selection, inter-predator predation — all S-43.
- Showing the 3 inert `PredatorTribeConfig` fields in any UI.
- Keeping `crossbreedingEnabled` as a CSV export column.
- Backfilling historical DB rows' tribe-config JSON with their old global crossbreeding value.

## Architecture / Approach

Six dependency-ordered phases: engine gate first (Phase 1), then the large mechanical removal
of the old global flag end-to-end (Phase 2), then two independent additions — admin range
(Phase 3) and start-form UI (Phase 4) — then the genuinely new live-edit panel (Phase 5), then
end-to-end verification (Phase 6). The live-edit panel is architecturally new: it generalizes a
flat-scalar Apply/cooldown/flash pattern to array/tribe-scoped fields, wired to mutations that
already exist and are tested but have never had a UI caller.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Engine core | Per-tribe crossbreeding gate in `reproducePopulation` | Getting the both-tribes-must-allow semantics exactly right |
| 2. Schema/validation/thread-through | Global flag fully removed, DB migration | Largest mechanical surface (~12 files); first-ever column drop in this project |
| 3. Predator speed range | Admin range for predator maxSpeed/minSpeed | Low risk — additive only |
| 4. Start-form UI | Predator tribe tabs + per-tribe crossbreeding Switch | UI mirrors existing pattern closely, but touches 3 components |
| 5. Live-edit panel | New array-scoped live-edit UI, boid + predator | Genuinely new UI pattern — no existing array-field live-edit to copy |
| 6. Verification | End-to-end script proving all 4 behaviors together | None significant — pure verification |

**Prerequisites:** F-10 (predator-tribe-concept, archived) must be shipped — confirmed done.
**Estimated effort:** ~6 phases, large relative to typical changes in this project — Phase 2 and
Phase 5 are each individually substantial.

## Open Risks & Assumptions

- The exact DROP COLUMN SQL drizzle-kit emits for this repo's version is unconfirmed until
  `npm run db:generate` is actually run in Phase 2 — assumed to be a direct single statement
  based on SQLite's native support and the column having no index/FK/unique constraint.
- `parameter-suggestion.test.ts`'s boolean-parameter test may need either a new boolean target
  field or removal of the boolean-handling branch entirely — determined during Phase 2.
- Whether the client-staged (pre-server-run) tick loop needs its own live-edit panel mirror is
  deferred to a during-implementation check in Phase 5; default assumption is no, since the
  underlying mutations are server-run-scoped.

## Success Criteria (Summary)

- A user can configure and start a run with multiple distinctly-tuned predator tribes via the UI.
- Per-tribe crossbreeding behaves correctly (same-tribe always mates; cross-tribe only when both
  tribes allow it) and is verified both by unit tests and an end-to-end script.
- A live mid-run edit to any tribe's config (boid or predator) visibly changes behavior within a
  few ticks, not just the stored value.
