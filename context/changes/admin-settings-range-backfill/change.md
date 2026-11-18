---
change_id: admin-settings-range-backfill
title: getOrSeedAdminSettings never backfills new parameterRanges keys into an existing row
status: implemented
created: 2026-11-18
updated: 2026-11-18
archived_at: null
---

## Notes

Confirmed production bug (live investigation, 2026-11-18): `/simulation`
shows a "Something went wrong" client-side crash (`src/app/error.tsx`
boundary) shortly after the parameters form renders.

## Confirmed root cause

`getOrSeedAdminSettings` (`src/server/api/routers/simulation.ts:179-204`):

```ts
if (existing) {
  return {
    parameterRanges: existing.parameterRanges as ParameterRanges,
    ...
  };
}
// only reaches DEFAULT_PARAMETER_RANGES when NO row exists yet
```

Production's `admin_settings` row (id=1) was seeded long ago and only has
the original ~15 range keys (`boidCount`, `separationWeight`,
`alignmentWeight`, `cohesionWeight`, `maxDurationSeconds`,
`predatorCount`, `protectionThreshold`, `foodStockInitial`,
`foodRegenRate`, `flockCount`, `energyThreshold`, `mutationChance`,
`mutationMagnitude`, `xyArea`, `zDepth`) — confirmed via a direct query
against the production DB through the running app container.

Since then, several milestones (per-tribe behavior weights, per-tribe
predator config, second predator tribe) added range keys the current
`/simulation` page's code reads: `maxSpeed`, `minSpeed`, `matePreference`,
`detectionRadius`, `captureRadiusMult`, `predatorFlockCount`,
`burstCostMult`, `burstMult`, `foodConsumptionRate`, `foodRegenShare`,
`foodStockShare`, `neighborRadius`, `predatorDetectionRadius`,
`separationRadius` — confirmed via grep for `ranges\.\w+\.(min|max|default)`
in `src/app/simulation/page.tsx`.

Because `getOrSeedAdminSettings` returns the existing row's JSON verbatim
with no merge against the current `DEFAULT_PARAMETER_RANGES` shape, the
client receives an incomplete `parameterRanges` object. The form renders
fine initially (uses its own local defaults), then crashes the moment it
reads one of the missing keys (e.g. `ranges.maxSpeed.min` on `undefined`).

This bug is invisible in dev/test because those DBs are always freshly
seeded — it only manifests on the one long-lived production DB whose row
predates these milestones and was never backfilled.

## Fix shape (not yet implemented — pending /10x-plan)

On the `existing` branch, merge `DEFAULT_PARAMETER_RANGES` as a base with
`existing.parameterRanges` overriding per-key (so admin-edited ranges are
preserved, missing keys get defaults) rather than returning the stored
object verbatim. Needs a decision on whether to also persist the merged
result back to the DB (so the backfill is permanent, not recomputed every
read) or just merge in-memory on every call.
