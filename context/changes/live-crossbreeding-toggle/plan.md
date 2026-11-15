# Live-adjust crossbreeding toggle Implementation Plan

## Overview

Add `crossbreedingEnabled` as a 6th live-adjustable field on both the server-owned and client-staged execution paths, so a user can toggle crossbreeding on or off mid-run and see the effect on subsequent reproduction events (mixed-flock pairs stop or start producing offspring). Unlike S-27/S-28/S-31's 5 numeric fields, this one is a boolean — `RANGED_PARAMETER_NAMES`/`DEFAULT_PARAMETER_RANGES`/`checkLiveParamRangesSoft`'s numeric-range machinery and `ParameterChangeEntry`'s `oldValue`/`newValue: number` shape are reused as-is, with the boolean coerced to 0/1 only at the specific call sites that need a number, never inside the shared functions themselves.

## Current State Analysis

- `crossbreedingEnabled` is already read fresh from `run.params.crossbreedingEnabled` every tick on the server-owned path (`server-run-registry.ts:298`) and consumed at the reproduction-eligibility check in `boids.ts:892` — confirmed via direct code inspection, the same proven-safe read pattern S-27/S-31's 5 fields use.
- On the client-staged path, `crossbreedingEnabled` is still a plain destructured prop, closed over by the mount effect and read at `simulation-canvas.tsx:756` inside the `tick()`'s `computeSingleRunTick` call — the exact same "closed-over, not ref'd" state the 5 numeric fields were in before S-28 gave them the ref treatment.
- `RANGED_PARAMETER_NAMES` (`parameter-ranges.ts:6-21`) explicitly excludes `crossbreedingEnabled` today, with a comment noting it's "a boolean toggle, not a ranged numeric parameter." `checkLiveParamRangesSoft`'s signature is `(patch: Partial<Record<RangedParameterName, number>>, ranges: ParameterRanges): string[]` — it assumes every value is a number.
- **Plan-review F1**: `checkAgainstAdminRanges` (`simulation.ts:152-166`, used by `start`/`startServer`, not `updateRunParams`) also loops `RANGED_PARAMETER_NAMES` and does `value < range.min || value > range.max`. `startInputSchema` already has `crossbreedingEnabled: z.boolean()` — once this field joins `RANGED_PARAMETER_NAMES`, `value`'s type becomes a union including `boolean`, and `<`/`>` against a boolean operand is a genuine TypeScript compile error. This is a third coercion-adjacent site the plan's original draft missed, now covered by Phase 1 item 6 below.
- `LiveAdjustableParams` (`server-run-registry.ts:58-65`) is `Pick<ServerRunParams, "foodRegenRate" | "protectionThreshold" | "energyThreshold" | "mutationChance" | "mutationMagnitude">`. `Pick` preserves each field's own type from `ServerRunParams` — adding `"crossbreedingEnabled"` to this union gives it type `boolean` with zero extra typing needed; `LiveParamPatch = Partial<LiveAdjustableParams>` and `applyLiveParams(runId, patch: LiveParamPatch)` both already accept a mixed-type patch object without any signature change.
- `ParameterChangeEntry` (`server-run-registry.ts:69-74`) types `oldValue`/`newValue` as `number`. `applyLiveParams`'s changelog-append loop (`server-run-registry.ts:190-201`) builds these generically for every field in the patch — this is the one place a boolean value needs coercing to `0`/`1` before being pushed, and the coercion should be generic (`typeof value === "boolean" ? Number(value) : value`), not a hardcoded check for this field's name, so it holds for any future boolean live field too.
- `updateRunParams`'s `checkLiveParamRangesSoft(patch, parameterRanges)` call (`simulation.ts:935`) passes the router's zod-typed `patch` object directly. Once the schema adds `crossbreedingEnabled: z.boolean().optional()`, that object genuinely contains a `boolean` value for this key — `checkLiveParamRangesSoft` itself must NOT change (per this slice's own decision), so the call site must build a converted copy (same generic `typeof value === "boolean" ? Number(value) : value` mapping) to pass in, leaving `patch` itself (passed to `applyLiveParams`) untouched.
- On the client-staged path, `simulation-canvas.tsx`'s live-edit panel already represents every field as `number` end-to-end (`LiveFormValues = Record<LiveField, number>`, `liveFieldRefs: Record<LiveField, React.RefObject<number>>`) — so representing `crossbreedingEnabled` as `0`/`1` there needs **no extra conversion at all** in `handleApplyLiveField`/`handleLiveFieldDraftChange`/`checkLiveParamRangesSoft`'s call (`simulation-canvas.tsx:503`) or in `parameterChangesRef`'s push (already numeric). The only conversion needed on this path is at the genuine consumption point: `tick()`'s `computeSingleRunTick` call must read `Boolean(crossbreedingEnabledRef.current)`, matching `ServerRunParams.crossbreedingEnabled: boolean`.
- `server-run-viewer.tsx`'s panel (`LIVE_FIELDS`/`LIVE_FIELD_LABELS`/`IMMEDIATE_FIELDS`/`FUTURE_OFFSPRING_FIELDS`/`renderLiveField`/`handleApplyLiveParams`) has zero references to `crossbreedingEnabled` today and uses the batched-apply-with-dirty-tracking flow (`LiveFormValues = Record<LiveField, number>`, same as client-staged). `handleApplyLiveParams`'s diff loop (`server-run-viewer.tsx:233-237`) builds `patch: Partial<LiveFormValues>` (all-number) before calling `updateRunParamsMutation.mutate({ runId, ...patch })` — since the mutation's zod schema expects a genuine `boolean` for this field, the patch-building step needs the one field converted back from the panel's internal `0`/`1` representation to a real `boolean` right before sending.
- Per the roadmap's own framing ("sees the effect on subsequent reproduction events"), this field's effect is identical in kind to `energyThreshold`/`mutationChance`/`mutationMagnitude`: it changes nothing for already-existing boids, only for future reproduction events. It belongs in `FUTURE_OFFSPRING_FIELDS`, not `IMMEDIATE_FIELDS`, on both panels.

## Desired End State

A user can toggle crossbreeding on or off on either an actively-running server-owned run (via `ServerRunViewer`'s panel) or an actively-running client-staged run (via `SimulationCanvas`'s panel), rendered as a `Switch` (not a `NumberField`), grouped under "Affects future offspring only." The toggle takes effect on the next reproduction-eligibility check — same-flock pairs are unaffected either way; only whether a mixed-flock pair can produce offspring changes. Both panels' existing cooldown/flash/warning/changelog machinery work for this field exactly as they do for the 5 numeric ones.

### Key Discoveries:

- `Pick`'s type preservation means no custom type is needed for the boolean field inside `LiveAdjustableParams`/`LiveParamPatch`/`applyLiveParams` — only `ParameterChangeEntry`'s push site and `checkLiveParamRangesSoft`'s call sites need a (generic, not field-specific) `number`-coercion step.
- The client-staged panel's internal state is already uniformly numeric, so it needs almost no new conversion logic; the server-owned panel's `handleApplyLiveParams` is the one place that needs an explicit boolean-back-conversion before sending the mutation.

## What We're NOT Doing

- Not changing `checkLiveParamRangesSoft`'s own implementation — only call sites that hand it a patch object get a small, generic (not field-name-specific) conversion step.
- Not adding a dedicated boolean-only live-adjust type or mutation — this field reuses the existing numeric machinery end-to-end, per this slice's own decision.
- Not changing `applyLiveParams`'s server-side throttle or `simulation-canvas.tsx`'s per-field cooldown — the existing shared 500ms gate covers this field automatically, no field-specific logic needed.
- Not adding special handling for a toggle flipped mid-reproduction — confirmed via code inspection that `reproducePopulation` evaluates `crossbreedingEnabled` fresh each tick as a simple gate on new pairings; there is no multi-tick "in-progress" reproduction state to interrupt.

## Implementation Approach

Three phases: (1) widen the shared type/schema/changelog machinery to admit one boolean field, (2) wire the server-owned panel's Switch into the existing batched-apply flow, (3) wire the client-staged panel's Switch into the existing per-field-apply flow. Each phase is independently testable and committable.

## Phase 1: Shared field-set widening

### Overview

Make the backend accept `crossbreedingEnabled` as a live-adjustable field, with the boolean-to-number coercion isolated to the two places that genuinely need a number.

### Changes Required:

#### 1. `RANGED_PARAMETER_NAMES` / `DEFAULT_PARAMETER_RANGES`

**File**: `src/server/simulation/parameter-ranges.ts`

**Intent**: Admit the field into the admin-range machinery with a degenerate `0`-`1` range, per this slice's own decision to reuse the numeric machinery rather than branch around it.

**Contract**: Add `"crossbreedingEnabled"` to `RANGED_PARAMETER_NAMES` (lines 6-21) and `crossbreedingEnabled: { min: 0, max: 1, default: 1 }` to `DEFAULT_PARAMETER_RANGES`, matching the staging form's own default (`page.tsx:43`, `useState(true)`). Update the file's header comment (lines 1-5) to drop the "crossbreedingEnabled is excluded" note, since it no longer is.

#### 2. `LiveAdjustableParams`

**File**: `src/server/simulation/server-run-registry.ts`

**Intent**: Widen the live-adjustable field set. `Pick` preserves the field's own `boolean` type from `ServerRunParams` with no extra typing.

**Contract**: Add `| "crossbreedingEnabled"` to the `Pick` union (lines 58-65).

#### 3. `getLiveRunState`'s literal field spread

**File**: `src/server/simulation/server-run-registry.ts`

**Intent**: Surface the current value for the server-owned panel's pre-fill.

**Contract**: Add `crossbreedingEnabled: run.params.crossbreedingEnabled` to the `liveParams` object (lines 141-147). No conversion — this stays a genuine boolean all the way to the panel's `syncLiveParams`.

#### 4. `ParameterChangeEntry`'s changelog push — generic boolean coercion

**File**: `src/server/simulation/server-run-registry.ts`

**Intent**: Let the changelog accept a boolean-valued field without widening `ParameterChangeEntry`'s `number` type or special-casing a field name.

**Contract**: In `applyLiveParams`'s changelog-append loop (lines 190-201), coerce `oldValue`/`newValue` generically: `typeof newValue === "boolean" ? Number(newValue) : newValue` for `newValue`, and the equivalent for `run.params[field]` when read as `oldValue`. `run.params = { ...run.params, ...patch }` (line 202) stays untouched — the real boolean is what gets stored on `run.params`.

#### 5. `updateRunParams`'s input schema and soft-check call site

**File**: `src/server/api/routers/simulation.ts`

**Intent**: Accept the field over the wire as a genuine boolean (matching `ServerRunParams`/`LiveAdjustableParams`), while still handing `checkLiveParamRangesSoft` a numeric value without modifying that function.

**Contract**: Add `crossbreedingEnabled: z.boolean().optional()` to the input schema (lines 902-909). At the `checkLiveParamRangesSoft(patch, parameterRanges)` call (line 935), pass a converted copy instead of `patch` directly — build it via a generic `Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, typeof v === "boolean" ? Number(v) : v]))` — and continue passing the original, unconverted `patch` to `applyLiveParams(runId, patch)` (line 936) unchanged.

#### 6. `checkAgainstAdminRanges`'s boolean-skip (plan-review F1)

**File**: `src/server/api/routers/simulation.ts`

**Intent**: Prevent a TypeScript compile error once `crossbreedingEnabled` joins `RANGED_PARAMETER_NAMES` — this function (used by `start`/`startServer`, not `updateRunParams`) also iterates the full name list and compares each value against its range with `<`/`>`, which is invalid once one of those values can be `boolean`.

**Contract**: In `checkAgainstAdminRanges`'s loop (lines 152-166), add a generic (not field-name-specific) skip at the top: `if (typeof value === "boolean") continue;` — booleans have no meaningful admin-configurable range to validate against, consistent with this slice's own "generic coercion, not field-specific branching" approach everywhere else.

#### 7. Exclude `crossbreedingEnabled` from the admin-settings numeric editor (plan-review F3)

**File**: `src/app/admin/settings/_components/admin-settings-form.tsx`

**Intent**: Avoid rendering a nonsensical "Min/Max/Default" numeric editor for a boolean toggle in the admin settings page — this page iterates `RANGED_PARAMETER_NAMES` directly (line 64), so once the field joins that list it would otherwise appear there unprompted.

**Contract**: At the `RANGED_PARAMETER_NAMES.map((name) => ...)` call (line 64), filter to `RANGED_PARAMETER_NAMES.filter((name) => name !== "crossbreedingEnabled")` before mapping — a one-line, narrowly-scoped exclusion, not a redesign of this form.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run check`
- `npx vitest run src/server/simulation/server-run-registry.test.ts` — add a test confirming `applyLiveParams` with a `crossbreedingEnabled` patch appends a changelog entry with `oldValue`/`newValue` as `0`/`1` (not `true`/`false`), while `getLiveRunState`'s `liveParams.crossbreedingEnabled` reads back as a genuine boolean.
- `npx vitest run src/server/api/routers/simulation.test.ts` — add a test confirming `updateRunParams` accepts `crossbreedingEnabled: true`/`false`, applies it, and returns `warnings: []` (a valid boolean never trips the degenerate 0-1 range); add a test confirming `start`/`startServer` still accept `crossbreedingEnabled: true`/`false` without throwing (plan-review F1's fix doesn't regress the existing admin-range check for this field).
- `npx vitest run src/server/simulation/parameter-ranges.test.ts` — update the "exactly one entry per RANGED_PARAMETER_NAMES" test's expected field list to include `crossbreedingEnabled` (plan-review F2).
- Full suite passes: `npm test`

#### Manual Verification:

- Open the admin settings page; confirm `crossbreedingEnabled` does NOT appear as a Min/Max/Default numeric editor (plan-review F3) — every other ranged field still does.

## Phase 2: Server-owned panel

### Overview

Add the Switch to `ServerRunViewer`'s existing batched-apply/dirty-tracking panel.

### Changes Required:

#### 1. `LIVE_FIELDS` / `LIVE_FIELD_LABELS` / `FUTURE_OFFSPRING_FIELDS`

**File**: `src/app/simulation/_components/server-run-viewer.tsx`

**Intent**: Register the 6th field in the existing field-set constants.

**Contract**: Add `"crossbreedingEnabled"` to `LIVE_FIELDS` (lines 33-39) and `FUTURE_OFFSPRING_FIELDS` (lines 61-65) — not `IMMEDIATE_FIELDS`, per this slice's effect-timing analysis. Add `crossbreedingEnabled: "Crossbreeding"` to `LIVE_FIELD_LABELS` (lines 45-51).

#### 2. Switch rendering for this one field

**File**: `src/app/simulation/_components/server-run-viewer.tsx`

**Intent**: Render a `Switch`, not a `NumberField`, for this field, while reusing the same warning/flash wrapper every other field gets.

**Contract**: In `renderLiveField` (lines 255-290), branch on `field === "crossbreedingEnabled"`: render a `Switch` (`checked={Boolean(values[field])}`, `onCheckedChange={(checked) => handleLiveFieldChange(field, checked ? 1 : 0)}`) inside the same flash-ring wrapper div and warning-list rendering every other field already gets, instead of the `NumberField` branch. `LiveFormValues`'s `Record<LiveField, number>` type is unchanged — the Switch's `checked` is derived from the stored `0`/`1`.

#### 3. Boolean conversion at the one mutation-send site

**File**: `src/app/simulation/_components/server-run-viewer.tsx`

**Intent**: Send the mutation the real boolean the server's zod schema expects, without widening `LiveFormValues`'s all-number type.

**Contract**: In `handleApplyLiveParams`'s diff loop (lines 232-237), when building the `patch` object to send, convert this one field's value back to boolean at the point it's added to the outgoing mutation payload: send `crossbreedingEnabled: Boolean(liveValues.crossbreedingEnabled)` instead of the raw `0`/`1` for that key specifically, while every other field keeps sending its raw number as today. (The local `patch` variable's compile-time type may need a small, explicit widening for this one key — e.g. `Partial<Omit<LiveFormValues, "crossbreedingEnabled">> & { crossbreedingEnabled?: boolean }` — rather than loosening `LiveFormValues` itself.)

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run check`
- `npx vitest run src/app/simulation/_components/server-run-viewer.test.tsx` — add tests confirming: (a) the panel renders a `Switch` (not a `NumberField`) for `crossbreedingEnabled`, grouped under "Affects future offspring only"; (b) toggling it and clicking Apply sends `updateRunParamsMutation.mutate` a real `boolean` for this field (not `0`/`1`).
- Full suite passes: `npm test`

#### Manual Verification:

- Start a server-owned run with two distinct flocks and `crossbreedingEnabled: true`; confirm the panel shows a Switch (not a number field) under "Affects future offspring only."
- Toggle it off mid-run via the panel; let the run tick for a while; confirm no new mixed-flock offspring appear for the remainder of the run (same-flock reproduction may continue) — the deterministic, behavior-level check this slice committed to, not just that the switch flipped.

## Phase 3: Client-staged panel

### Overview

Add the ref + Switch to `SimulationCanvas`'s per-field-apply panel, mirroring S-28's exact pattern for the 5 numeric fields.

### Changes Required:

#### 1. `crossbreedingEnabledRef` + `tick()`'s read site

**File**: `src/app/simulation/_components/simulation-canvas.tsx`

**Intent**: Give this field the same ref treatment the 5 numeric fields got in S-28, so a panel edit reaches the running tick loop.

**Contract**: Add `crossbreedingEnabledRef = useRef(Number(crossbreedingEnabled))` alongside the 5 existing refs (lines 432-436), initialized as a number to match `liveFieldRefs`'s `Record<LiveField, React.RefObject<number>>` typing. Add it to `liveFieldRefs` (lines 449-455). In `tick()`'s `computeSingleRunTick` call (around line 756), replace the closed-over `crossbreedingEnabled` identifier with `Boolean(crossbreedingEnabledRef.current)` — this is the one place the numeric ref is converted back to the real boolean `ServerRunParams.crossbreedingEnabled` expects.

#### 2. `LIVE_FIELDS` / `LIVE_FIELD_LABELS` / `FUTURE_OFFSPRING_FIELDS` + initial panel state

**File**: `src/app/simulation/_components/simulation-canvas.tsx`

**Intent**: Register the field in the client-staged panel's constants and seed its initial draft value.

**Contract**: Add `"crossbreedingEnabled"` to `LIVE_FIELDS` and `FUTURE_OFFSPRING_FIELDS` (mirroring `server-run-viewer.tsx`'s Phase 2 change), `crossbreedingEnabled: "Crossbreeding"` to `LIVE_FIELD_LABELS`. Add `crossbreedingEnabled: Number(crossbreedingEnabled)` to the initial `liveValues` state object.

#### 3. Switch rendering for this one field

**File**: `src/app/simulation/_components/simulation-canvas.tsx`

**Intent**: Render a `Switch` for this field in the per-field-apply panel, mirroring Phase 2's branch in `server-run-viewer.tsx`'s `renderLiveField`.

**Contract**: In `renderLiveField` (lines 529-561ish), branch on `field === "crossbreedingEnabled"`: render a `Switch` (`checked={Boolean(liveValues[field])}`, `onCheckedChange={(checked) => { handleLiveFieldDraftChange(field, checked ? 1 : 0); handleApplyLiveField(field, checked ? 1 : 0); }}`) instead of the `NumberField` + separate Apply button — a boolean toggle applies immediately on flip rather than needing a separate stage-then-apply step, since there's no intermediate "typing" state the way a number field has. Keep the same flash-ring wrapper and warning-list rendering every other field gets.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run check`
- `npx vitest run src/app/simulation/_components/simulation-canvas.test.tsx` — add tests confirming: (a) the panel renders a `Switch` for `crossbreedingEnabled` under "Affects future offspring only"; (b) toggling it reaches `computeSingleRunTick`'s actual call argument as a real `boolean` (asserted against the mocked `computeSingleRunTick`'s call args, same pattern S-28's existing ref test uses); (c) `buildStopInput()`'s `parameterChanges` includes a `0`/`1`-valued entry for this field when toggled.
- Full suite passes: `npm test`

#### Manual Verification:

- Start a client-staged run with two distinct flocks and crossbreeding enabled; confirm the panel shows a Switch under "Affects future offspring only."
- Toggle it off mid-run; let the run tick for a while; confirm no new mixed-flock offspring appear for the remainder of the run (same-flock reproduction may continue) — the same deterministic, behavior-level check as Phase 2's, now on the client-staged path.

## Performance Considerations

None — this adds one more entry to existing, already-bounded machinery (one more ref, one more changelog field type); no new queries, no new arrays, no new persistence shape.

## Migration Notes

None — `crossbreedingEnabled` becomes a new optional key in `LiveAdjustableParams`/the live-adjust zod schemas; no DB schema change (the field already exists on `simulationRuns` as a start-time column, untouched by this slice).

## References

- Research/precedent: `context/archive/2026-11-15-live-parameter-adjustment/` (S-27), `context/archive/2026-11-15-correct-live-parameter-field-set/` (S-31), `context/archive/2026-11-15-client-staged-live-parameter-parity/` (S-28) — this slice mirrors S-28's exact ref-treatment pattern for the client-staged path.
- Shared validation: `src/server/simulation/parameter-ranges.ts`
- Registry: `src/server/simulation/server-run-registry.ts`
- Router: `src/server/api/routers/simulation.ts`
- Server-owned panel: `src/app/simulation/_components/server-run-viewer.tsx`
- Client-staged panel: `src/app/simulation/_components/simulation-canvas.tsx`
- Lesson applied: `context/foundation/lessons.md` — "UI accepts input is not feature verified" (both phases' Manual Verification target the actual reproduction-eligibility behavior, not just that the switch flipped)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Shared field-set widening

#### Automated

- [ ] 1.1 Type checking passes: `npm run typecheck`
- [ ] 1.2 Linting passes: `npm run check`
- [ ] 1.3 `npx vitest run src/server/simulation/server-run-registry.test.ts`
- [ ] 1.4 `npx vitest run src/server/api/routers/simulation.test.ts`
- [ ] 1.5 `npx vitest run src/server/simulation/parameter-ranges.test.ts`
- [ ] 1.6 Full suite passes: `npm test`

#### Manual

- [ ] 1.7 Admin settings page does not show crossbreedingEnabled as a numeric editor

### Phase 2: Server-owned panel

#### Automated

- [ ] 2.1 Type checking passes: `npm run typecheck`
- [ ] 2.2 Linting passes: `npm run check`
- [ ] 2.3 `npx vitest run src/app/simulation/_components/server-run-viewer.test.tsx`
- [ ] 2.4 Full suite passes: `npm test`

#### Manual

- [ ] 2.5 Panel shows a Switch for crossbreedingEnabled under "Affects future offspring only"
- [ ] 2.6 Toggling off mid-run stops new mixed-flock offspring for the remainder of the run

### Phase 3: Client-staged panel

#### Automated

- [ ] 3.1 Type checking passes: `npm run typecheck`
- [ ] 3.2 Linting passes: `npm run check`
- [ ] 3.3 `npx vitest run src/app/simulation/_components/simulation-canvas.test.tsx`
- [ ] 3.4 Full suite passes: `npm test`

#### Manual

- [ ] 3.5 Panel shows a Switch for crossbreedingEnabled under "Affects future offspring only"
- [ ] 3.6 Toggling off mid-run stops new mixed-flock offspring for the remainder of the run
