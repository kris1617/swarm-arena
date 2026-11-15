# Implementation Plan: Correct S-27's live-adjustable field set

## Overview

S-27 (archived) shipped live-adjustment for 5 fields on a running server-owned simulation: `separationWeight`, `alignmentWeight`, `cohesionWeight`, `foodRegenRate`, `protectionThreshold`. Direct code inspection confirms the first 3 are **per-boid genetic traits** (`boid.genes.separationWeight`, etc.) — set once at birth, inherited by offspring as a blend of their two parents' genes — and the flocking force calculation reads each boid's *own* gene value, never the live-patched `run.params`. **Live-adjusting these 3 fields has no effect on anything, old boid or new offspring.** `foodRegenRate`/`protectionThreshold` are genuinely global (confirmed, read fresh every tick) and already work correctly.

This plan removes the 3 non-functional fields from the live-adjustable set and replaces them with `energyThreshold`, `mutationChance`, and `mutationMagnitude` — confirmed genuinely global, consulted only at the moment of reproduction, so live-adjusting them correctly affects only future offspring, never retroactively changing an existing individual.

All product decisions below were resolved via user interview (2026-11-15) and are fixed:

1. **UI framing**: the panel groups fields under two small headings — "Takes effect immediately" (foodRegenRate, protectionThreshold) and "Affects future offspring only" (energyThreshold, mutationChance, mutationMagnitude) — so a user isn't confused about why a change to the second group doesn't visibly do anything until the next birth.
2. **Manual verification**: each new field gets a deterministic, isolating before/after test (not a statistical "looks about right" observation) — the exact rigor S-27's own verification lacked.
3. **Lesson recorded**: `context/foundation/lessons.md` already has a new entry (committed `db09de6`, ahead of this plan) capturing the "UI accepts input ≠ feature verified" rule this defect revealed.

## Current State Analysis

- `LiveAdjustableParams` (`src/server/simulation/server-run-registry.ts:58-65`) is `Pick<ServerRunParams, "separationWeight" | "alignmentWeight" | "cohesionWeight" | "foodRegenRate" | "protectionThreshold">`. This is the single source of truth the rest of the mechanism (`applyLiveParams`, `LiveRunSnapshot.liveParams`, `getLiveRunState`, `ParameterChangeEntry.field`) all derive from via `keyof`/`Pick` — changing this one type propagates everywhere except the two call sites that spell out the 5 fields literally (see below).
- `getLiveRunState` (`server-run-registry.ts:131-149`) literally spells out the 5 fields when building `liveParams` (lines 141-147) — this is the one place that needs a matching literal edit, not just a type change.
- `applyLiveParams` itself (`server-run-registry.ts:172-205`) is fully generic over `LiveParamPatch` (a `Partial<LiveAdjustableParams>`) — no changes needed there; it will automatically accept whatever fields the type allows.
- `checkLiveParamRangesSoft` (`src/server/api/routers/simulation.ts:180-197`) is generic over `RangedParameterName` — no changes needed; `energyThreshold`/`mutationChance`/`mutationMagnitude` are already in `RANGED_PARAMETER_NAMES` (`parameter-ranges.ts`) with defined ranges (`DEFAULT_PARAMETER_RANGES`: `energyThreshold: positive`, `mutationChance`/`mutationMagnitude`: `0-1`).
- `updateRunParams`'s zod input schema (`simulation.ts:900-909`) spells out the 5 fields literally with their own constraints — needs the 3-out-3-in swap, mirroring `startInputSchema`'s exact constraints for the 3 new fields (`simulation.ts:68-70`: `energyThreshold: z.number().finite().positive()`, `mutationChance`/`mutationMagnitude: z.number().min(0).max(1)`).
- `ServerRunViewer`'s `LIVE_FIELDS`/`LIVE_FIELD_LABELS` (`src/app/simulation/_components/server-run-viewer.tsx:33-51`) are the only frontend place the 5 fields are named. Everything downstream (`syncLiveParams`, `handleLiveFieldChange`, `handleApplyLiveParams`, `warningsForField`, dirty-tracking, flash, cooldown) iterates `LIVE_FIELDS` generically and needs **no changes** — only the constant array/label map and the render section (lines ~376-400, where fields are mapped to `NumberField`s) need to swap which fields appear and add the two group headings.
- `src/app/simulation/page.tsx` already has `NumberField`s for "Energy threshold" (line 487), "Mutation chance" (line 496), "Mutation magnitude" (line 505) in the staging form — these exact label strings are the ones to reuse in `LIVE_FIELD_LABELS` for consistency.
- No reference/documentation page or other file names the specific 5 live-adjustable fields (confirmed via repo-wide grep) — no other file needs updating.
- `src/app/runs/[runId]/page.tsx`'s changelog `ReferenceLine` overlay (S-27 Phase 3) renders `entry.field` as a generic label string — no change needed; it will display whatever field name a `ParameterChangeEntry` carries, old or new.

## What We're NOT Doing

- Not changing `applyLiveParams`, `checkLiveParamRangesSoft`, the changelog persistence/threading, the `ReferenceLine` overlay, or any snapshot/resume logic — all of these are generic over the field set and need no edits.
- Not attempting to make `separationWeight`/`alignmentWeight`/`cohesionWeight` live-adjustable by changing the genetic-inheritance model (e.g., having offspring blend toward a live "tribe baseline" instead of pure parent-gene blending) — the user explicitly chose to swap the field set over altering the inheritance design (roadmap S-31's resolved decision).
- Not touching `simulationRuns.history`'s stored shape, the DB schema, or adding a migration — this is a field-allowlist change on an existing mechanism, not a new one.
- Not backfilling or reinterpreting any `parameterChanges` entries a real production row might already have for the removed fields (none exist — the only live production use was this session's own test-and-delete verification cycles).
- Not changing client-staged runs (`simulation-canvas.tsx`) — that's S-28's separate scope, sequenced after this change specifically so it targets the corrected set.

## Implementation Approach

A type-level field swap (`LiveAdjustableParams`) plus two literal call-site updates (the zod schema, `getLiveRunState`'s object literal) on the backend, and a constant-array/label-map swap plus a render-grouping addition on the frontend — no new mechanism anywhere.

### Changes Required:

## Phase 1: Backend — field-set swap

### 1. `LiveAdjustableParams` type

**File**: `src/server/simulation/server-run-registry.ts`

**Intent**: The single source of truth for the live-adjustable field set — changing this `Pick` propagates to `LiveParamPatch`, `ParameterChangeEntry.field`, and `LiveRunSnapshot.liveParams`'s declared type automatically.

**Contract**: Change the `Pick` (lines 58-65) to:
```ts
export type LiveAdjustableParams = Pick<
  ServerRunParams,
  "foodRegenRate" | "protectionThreshold" | "energyThreshold" | "mutationChance" | "mutationMagnitude"
>;
```

### 2. `getLiveRunState`'s literal field spread

**File**: `src/server/simulation/server-run-registry.ts`

**Intent**: This function builds `liveParams` by spelling out each field explicitly (not generically) — the one call site that needs a literal edit to match the new type.

**Contract**: Replace the `liveParams` object (lines 141-147) with the new 5 fields read off `run.params`: `foodRegenRate`, `protectionThreshold`, `energyThreshold`, `mutationChance`, `mutationMagnitude`.

### 3. `updateRunParams`'s input schema

**File**: `src/server/api/routers/simulation.ts`

**Intent**: Accept the new field set in the mutation's input, with the exact same constraints `startInputSchema` already uses for these 3 fields.

**Contract**: Replace the zod object's 5 fields (lines 900-909) with:
```ts
z.object({
  runId: z.number(),
  foodRegenRate: z.number().finite().nonnegative().optional(),
  protectionThreshold: z.number().int().nonnegative().optional(),
  energyThreshold: z.number().finite().positive().optional(),
  mutationChance: z.number().min(0).max(1).optional(),
  mutationMagnitude: z.number().min(0).max(1).optional(),
})
```
No other change in this procedure — `checkLiveParamRangesSoft`, `applyLiveParams`, and the throttle/ownership logic are all generic and already correct.

### Success Criteria:

#### Automated

- [ ] Type checking passes: `npm run typecheck`
- [ ] Linting passes: `npm run check`
- [ ] `npx vitest run src/server/simulation/server-run-registry.test.ts` — update the 5 tests that patch `separationWeight` as the live-adjusted field: "returns not-found for an unregistered runId" (L298), "patches run.params and appends a changelog entry..." (L304), "throttles a second call within PARAM_UPDATE_THROTTLE_MS of the first" (L356), "parameterChanges survives a snapshot/resume round-trip" (L396), "resuming a snapshot missing parameterChanges (pre-S-27 data) does not crash the run" (L440) — swap to one of the new fields (e.g. `mutationMagnitude`); test *behavior* (patch applies, changelog records, snapshot/resume survives, throttle works) is unchanged, only the field name changes. (`BASE_PARAMS`/`BoidGenes` fixtures elsewhere in this file use these names as genetic fields, unrelated — leave untouched.)
- [ ] `npx vitest run src/server/api/routers/simulation.test.ts` — update the 6 tests inside `describe("simulationRouter.updateRunParams", ...)` (L2613-2759) that patch `separationWeight`: "applies a valid patch..." (L2634), "applies an out-of-range value..." (L2647 — now use an out-of-range `mutationChance` or `energyThreshold`), "rejects a second call within the throttle window..." (L2665), "rejects with FORBIDDEN for a non-owner" (L2679), "rejects with BAD_REQUEST for a saved (non-active) run" (L2708), "rejects with BAD_REQUEST for a non-existent run" (L2725). (L1861/1870's `field: "separationWeight"` is an unrelated `getRunAnalysis` changelog-display fixture string — that display path is generic, leave untouched.)
- [ ] Full suite passes: `npm test`

#### Manual

- [ ] Start a server-owned run; call `updateRunParams` with `mutationMagnitude: 0`; let at least one reproduction event occur; confirm the offspring's genes exactly match the blended-parent value with zero mutation applied (no deviation) — a deterministic, isolating signal that this field now has a real effect.
- [ ] On the same or a fresh run, call `updateRunParams` with `energyThreshold` set far above any boid's current energy; confirm no further reproduction events occur for the remainder of the run.

## Phase 2: Frontend — panel field swap + grouped UI

### 1. `LIVE_FIELDS`/`LIVE_FIELD_LABELS`

**File**: `src/app/simulation/_components/server-run-viewer.tsx`

**Intent**: Swap which 5 fields the panel edits, reusing `simulation/page.tsx`'s exact label wording for the 3 new fields for consistency with the staging form.

**Contract**: Replace `LIVE_FIELDS` (lines 33-39) with `["foodRegenRate", "protectionThreshold", "energyThreshold", "mutationChance", "mutationMagnitude"]` (satisfies `readonly (keyof LiveAdjustableParams)[]`, so a mismatch with the server-side type is still a compile error). Replace `LIVE_FIELD_LABELS` (lines 45-51) with: `foodRegenRate: "Food regen rate"`, `protectionThreshold: "Protection threshold"`, `energyThreshold: "Energy threshold"`, `mutationChance: "Mutation chance"`, `mutationMagnitude: "Mutation magnitude"`.

### 2. Grouped rendering

**File**: `src/app/simulation/_components/server-run-viewer.tsx`

**Intent**: Visually separate the 2 immediate-effect fields from the 3 future-offspring-only fields so a user isn't confused about why the latter group doesn't visibly do anything until the next birth — the UI-level fix for the exact confusion this defect caused.

**Contract**: Add a small constant grouping the field names (e.g. `IMMEDIATE_FIELDS` / `FUTURE_OFFSPRING_FIELDS`, both `readonly (keyof LiveAdjustableParams)[]` subsets of `LIVE_FIELDS`), and in the panel's render section (where `LIVE_FIELDS.map(...)` currently renders each `NumberField`, around lines 376-400), render two sub-sections instead of one flat map: a heading "Takes effect immediately" followed by the immediate fields' `NumberField`s, then a heading "Affects future offspring only" followed by the other 3 — same `NumberField`/warning/flash rendering per field as today, just grouped under two headings instead of one flat list.

No existing precedent covers this exact shape — confirmed via plan-review: `admin-settings-form.tsx`'s `<fieldset>`/`<legend>` idiom groups exactly one field per fieldset (legend = that field's own name), not multiple fields under one shared heading. Don't reach for that idiom here. Instead, use a plain heading element matching this panel's existing text conventions (e.g. a `<p className="text-sm font-semibold">` or similar small label, consistent with how this file already labels its other sections) followed by a `<div className="flex flex-col gap-2">` wrapping that group's `NumberField`s — two such heading+div pairs, one per group.

### Success Criteria:

#### Automated

- [ ] Type checking passes: `npm run typecheck`
- [ ] Linting passes: `npm run check`
- [ ] `npx vitest run src/app/simulation/_components/server-run-viewer.test.tsx` — update the 4 tests inside the "live-parameter-adjustment (S-27) Phase 2: live-edit panel" describe block (which all share the `LIVE_PARAMS_FIXTURE` at L98-100): "pre-fills the panel from the subscription's first pushed liveParams" (L276), "clicking Apply after changing 2 of 5 fields sends only those 2 fields" (L289), "disables the Apply button immediately after a successful apply (cooldown)" (L311), "does not overwrite a field being actively edited when a new subscription push arrives" (L341) — swap `LIVE_PARAMS_FIXTURE`/field references to the new field set; add/confirm a test that both group headings render.
- [ ] Full suite passes: `npm test`

#### Manual

- [ ] Open a server-owned run's live view; confirm the panel shows exactly 5 fields split under two headings ("Takes effect immediately": food regen rate, protection threshold; "Affects future offspring only": energy threshold, mutation chance, mutation magnitude).
- [ ] Apply a change to a field in each group; confirm both groups' success-flash/warning/cooldown behavior work identically to how the flat panel worked before (no regression in the generic mechanism).

## Performance Considerations

None — this is a field-allowlist change on an existing, already-performant mechanism (no new queries, no new arrays, no new persistence shape).

## Migration Notes

None — `LiveAdjustableParams` is a TypeScript type, not a DB schema; `simulationRuns.history`'s `parameterChanges` entries are schema-less JSON and already display any `field` string generically on the analysis chart, old or new.

## References

- Roadmap: `context/foundation/roadmap.md` S-31 (`correct-live-parameter-field-set`), M-6
- Defect source: S-27 (`context/archive/2026-11-15-live-parameter-adjustment/`) — archived, immutable; this change corrects its field set without modifying it
- Lesson recorded: `context/foundation/lessons.md` — "UI accepts input is not feature verified" (commit `db09de6`)
- Change notes: `context/changes/correct-live-parameter-field-set/change.md`
- Registry: `src/server/simulation/server-run-registry.ts`
- Router: `src/server/api/routers/simulation.ts`
- Live-view UI: `src/app/simulation/_components/server-run-viewer.tsx`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Backend — field-set swap

#### Automated

- [x] 1.1 Type checking passes: `npm run typecheck` — 53db13a
- [x] 1.2 Linting passes: `npm run check` — 53db13a
- [x] 1.3 `npx vitest run src/server/simulation/server-run-registry.test.ts` — 53db13a
- [x] 1.4 `npx vitest run src/server/api/routers/simulation.test.ts` — 53db13a
- [x] 1.5 Full suite passes: `npm test` — 53db13a

#### Manual

- [x] 1.6 mutationMagnitude=0 produces zero-deviation offspring genes — 53db13a
- [x] 1.7 High energyThreshold stops further reproduction — 53db13a

### Phase 2: Frontend — panel field swap + grouped UI

#### Automated

- [x] 2.1 Type checking passes: `npm run typecheck` — 4c3e2e5
- [x] 2.2 Linting passes: `npm run check` — 4c3e2e5
- [x] 2.3 `npx vitest run src/app/simulation/_components/server-run-viewer.test.tsx` — 4c3e2e5
- [x] 2.4 Full suite passes: `npm test` — 4c3e2e5

#### Manual

- [x] 2.5 Panel shows 5 fields under 2 correctly-grouped headings — 4c3e2e5
- [x] 2.6 Flash/warning/cooldown behavior unchanged for both groups — 4c3e2e5
