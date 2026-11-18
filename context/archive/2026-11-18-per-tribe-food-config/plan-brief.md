# Plan Brief: Per-tribe food config (S-41)

Full plan: `context/changes/per-tribe-food-config/plan.md`

## What this does

Each boid tribe gets its own food contribution — a stock share, a regen
share, and its own per-boid consumption rate — that combine into the single
shared food pool (never separate pools). Grew beyond the roadmap's original
"config-only" scope during planning: also adds live mid-run adjustment
(including a new delta-injection mechanic for stock) and an actual change to
the resource-management score formula to weight per-tribe balance.

## Starting Point

- Food today: one global scalar pool, one flat regen rate, one flat
  per-boid consumption constant — zero `flockId` awareness anywhere.
- `TribeConfig` has no food fields at all — same "genuinely new ground" as
  every F-09 field was before that change.
- `applyLiveTribeConfigs` does a wholesale array replace today — no
  per-field diffing exists anywhere in this codebase yet.
- `ScoredRun`/`disclose()` already handles one comparability reason
  (`wasEverThrottled`) — the established pattern this plan extends to a
  second.

## Key Decisions

| Decision | Choice | Why |
|---|---|---|
| Pool combination | Sum per-tribe stock/regen shares into the one shared pool | Simplest, most legible mapping; matches the Lua reference's global-food model |
| Consumption rate | Also per-tribe (not flat) | User's explicit choice — widens scope past the roadmap's original estimate |
| Live adjustment | Yes, following F-09's `applyLiveTribeConfigs` precedent | Preserves `foodRegenRate`'s existing live-adjustability (S-27), which per-tribe food would otherwise regress |
| Live stock mechanism | Delta-inject against the tribe's own last-submitted share | Composable across repeated edits; a wholesale replace would otherwise silently reset the live pool |
| Scoring | Formula change (not just a new diagnostic) | User's explicit choice, despite the score-comparability tradeoff this project has otherwise avoided |
| Score backward-compat | New formula is a strict generalization — reduces to the exact old formula when imbalance is zero | Preserves historical/single-tribe/balanced-run score meaning even though the formula itself changed |
| Non-comparability disclosure | New `wasEverFoodImbalanced` sticky marker, extends `ScoredRun` | Same pattern as `wasEverThrottled` — don't silently change what a score means without disclosing it |
| Admin ranges | One shared range per field, not per-tribe | Matches F-09's own precedent |
| UI placement | Joins F-09's existing per-tribe tabs | Reuses the exact Tabs/NumberField structure, no new UI pattern |

## Phases

1. **Data model & schema** — 3 new `TribeConfig` fields, admin ranges, validation
2. **Engine: pool seeding & regen** — sum-combination, `applyHunger`'s own math untouched
3. **Engine: per-tribe consumption** — `applyHunger` gains per-boid tribe lookup
4. **Live adjustment** — regen/consumption replace-and-use; stock gets delta-injection
5. **Scoring** — formula change (backward-compatible special case) + disclosure marker
6. **UI** — 3 fields join the existing per-tribe tabs
7. **Backward compatibility & verification** — legacy-row handling + gene/value-level manual checks

**Prerequisites**: none blocking — F-09's `tribeConfigs`/`TribeConfig`/`applyLiveTribeConfigs`/per-tribe tab infrastructure already exists to build on.
**Estimated effort**: MEDIUM-HIGH — phases 1-3, 6 are low-risk extensions of F-09's established patterns; phases 4-5 are genuinely new mechanics (delta-injection live-edit, a real scoring-formula change) needing careful backward-compat verification.

## What We're NOT Doing

- Not splitting `foodStock` into separate per-tribe pools.
- Not giving tribes separate admin ranges for food fields.
- Not adding a separate UI section for food (joins existing tabs).

## References

- `context/archive/2026-11-17-per-tribe-behavior-weights/plan.md` — direct
  precedent for nearly every structural decision here.
- `context/foundation/lessons.md` — the verification discipline Phase 7
  exists to repeat correctly this time.
