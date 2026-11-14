# Restyle the simulation staging form and live view onto the F-06 design-system contract Implementation Plan

## Overview

Close the three design-system-contract charges found during `/10x-ui simulation`'s audit (recorded in `research.md`): one accidental-architecture landmark issue (shared with dashboard-restyle's fix), one missing-shared-component gap (12 duplicated form-field blocks), and one loading-state gap for the running/saved run-list panels. The view is already token-compliant and already handles its mutation error states well — no color/token charges here.

## Current State Analysis

- `src/app/simulation/page.tsx` is fully token-compliant (hardcoded-value scan: zero hits on styling code) — not a missing-tokens case. The only `rgb(...)` matches are in `simulation-canvas.tsx`'s runtime boid-color rendering, an already-accepted exception per `AGENTS.md`.
- The page's root `<main>` (`simulation/page.tsx:221`) is nested inside `AppShell`'s `SidebarInset`, which is also a `<main>` — the identical issue dashboard-restyle (S-16) just fixed for `dashboard/page.tsx`, confirmed recurring here exactly as that change's research predicted.
- Twelve near-identical `<label>`+`<Input type="number">` blocks (`simulation/page.tsx:338-514`) share the same className and structure, differing only in label text, `id`, bounds, and the `value`/`onChange` pair — a duplicated primitive, not yet user-visible but a drift risk on every future touch to this form's field styling.
- `runningRunsQuery`/`savedRunsQuery` (`simulation/page.tsx:232,270`) render `null` while pending, so their panels simply appear a moment after the form — a milder version of the loading-state gap dashboard-restyle fixed (no misleading message here, just a visible layout shift).
- User confirmed (via `/10x-ui`'s planning interview) that this third charge is in scope for this change, not deferred.
- Full evidence and file:line anchors: `context/changes/staging-live-view-restyle/research.md`.

## Desired End State

The simulation page has exactly one `<main>` landmark (owned by `AppShell`), its 12 numeric fields render through one shared `NumberField` component instead of 12 hand-duplicated blocks, and both run-list panels show a brief loading skeleton instead of popping in silently once their query resolves. No visual or behavioral regression to the staging form's validation/clamping, the run-switcher, save/resume mutations, or the suggestion card.

### Key Discoveries

- `NumberField` is a genuinely reusable composite (label + bounded numeric input), not a one-off — it belongs in `src/components/ui/` alongside `Input`/`Switch`/`Button`, per `AGENTS.md`'s "Shared components live in `src/components/ui`" rule, even though nothing outside this page uses it yet.
- `Skeleton` (from `src/components/ui/skeleton.tsx`) already exists in this repo (installed in F-06, reused by dashboard-restyle) — no new primitive needed for Charge 3.

## What We're NOT Doing

- Not touching `runs/[runId]/page.tsx` or `runs/compare/page.tsx` — the same nested-`<main>` pattern recurs there too, but fixing it is S-18's job when that view gets restyled.
- Not changing the staging form's clamping/validation logic (`buildStartInput`), the run-switcher's polling cadence, the save/resume mutations, or the suggestion card's content — only the form-field markup and the loading/landmark fixes.
- Not introducing any new color, spacing, or typography token — none is needed; the view is already token-compliant.
- Not adding a loading indicator for `rangesQuery` — its fallback-to-defaults behavior is intentional by design (documented in the existing code comment) so the form isn't broken on first paint, not a gap.

## Implementation Approach

Three phases, following `/10x-ui`'s prescribed order (environment/library → token values → one view → states): build the new shared `NumberField` component first, apply all three fixes to the one view, then verify the full 7-state matrix.

## Phase 1: Build the shared NumberField component

### Overview

Extract the repeated label+bounded-number-input pattern into one reusable component in `src/components/ui/`.

### Changes Required:

#### 1. Add the NumberField component

**File**: `src/components/ui/number-field.tsx` (new file)

**Intent**: A small wrapper around the existing `Input` component (not a new primitive — `Input` already has the correct token styling and focus-visible treatment) that takes `label`, `id`, `min`, `max`, `step?`, `value`, and `onChange: (value: number) => void`, rendering the same `<label className="flex flex-col gap-1" htmlFor={id}>{label}<Input .../></label>` structure the 12 call sites currently duplicate by hand. `onChange` takes the already-parsed number (the component does the `Number(e.target.value)` conversion internally), so call sites pass a plain number-setter directly.

**Contract**: `export function NumberField({ label, id, min, max, step, value, onChange }: NumberFieldProps)` where `NumberFieldProps = { label: React.ReactNode; id: string; min: number; max: number; step?: string; value: number; onChange: (value: number) => void }`. Not yet used anywhere in this phase — Phase 2 replaces the 12 call sites.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run check`
- Full suite still passes: `npm test`

#### Manual Verification:

- (none for this phase — the component isn't used anywhere yet; Phase 2 wires it in)

---

## Phase 2: Apply the three fixes to the simulation view

### Overview

Edit `src/app/simulation/page.tsx` only: change the root element from `<main>` to `<div>`, replace all 12 hand-assembled numeric-field blocks with `NumberField`, and add a loading skeleton for the running/saved run-list panels.

### Changes Required:

#### 1. Fix the nested `<main>` landmark

**File**: `src/app/simulation/page.tsx`

**Intent**: Change the page's root element (line 221) from `<main className="...">` to `<div className="...">` — same className, same visual gradient/layout — identical to dashboard-restyle's fix, since `AppShell`'s `SidebarInset` already owns the page's one correct `<main>` landmark.

**Contract**: No className or layout change — element tag only.

#### 2. Replace the 12 numeric-field blocks with `NumberField`

**File**: `src/app/simulation/page.tsx`

**Intent**: Replace each of the 12 `<label>`+`<Input type="number">` blocks (boid count, separation/alignment/cohesion weight, max duration, predator count, protection threshold, initial food stock, food regen rate, flock count, energy threshold, mutation chance, mutation magnitude) with `<NumberField label="..." id="..." min={...} max={...} step={...} value={...} onChange={set...} />`, passing each field's existing `setXxx` state setter directly as `onChange` (the component now does the `Number(...)` conversion that each call site previously duplicated inline).

**Contract**: No change to any field's `min`/`max`/`step` bounds, its associated `useState`, or `buildStartInput`'s clamping logic — only the markup assembling each field changes. The "Crossbreeding enabled" `Switch` (not a `NumberField`) is untouched.

#### 3. Add a loading skeleton for the run-list panels

**File**: `src/app/simulation/page.tsx`

**Intent**: Render a brief `Skeleton` placeholder (from `src/components/ui/skeleton.tsx`) above the staging form while `runningRunsQuery.isPending || savedRunsQuery.isPending`, instead of having both panels simply render `null` until their data arrives.

**Contract**: No change to either query's `refetchInterval`, the run-switcher logic, or the save/resume mutations — purely an additional render branch checked before the existing `data && data.length > 0` conditionals.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run check`
- Full suite still passes: `npm test`
- Hardcoded-value scan on `src/app/simulation/page.tsx` still returns zero hits (no literal colors introduced by this phase)

#### Manual Verification:

- All 12 numeric fields render identically to before (same labels, bounds, step increments) and still update their respective state on change
- Browser dev tools' accessibility tree shows exactly one `main` landmark on the simulation page
- Reloading with existing running/saved server runs present shows a brief loading skeleton before the run-switcher panels appear, instead of a silent pop-in
- The staging form's "Start"/"Start on server" buttons, the suggestion card, and the run-switcher/save/resume buttons all behave exactly as before

---

## Phase 3: States verification pass

### Overview

Verify all seven states (default, hover, focus-visible, disabled, error, empty, loading) are either shown correctly or N/A with a reason, checking each against the actual query/mutation hooks this view uses (per the lesson recorded from dashboard-restyle's impl-review), and run the visual gate.

### Changes Required:

#### 1. Verify and screenshot the 7-state matrix

**File**: none (verification only, no new code)

**Intent**: Confirm each state: default (token-driven, unchanged), hover (existing `hover:` classes on `Button`, unchanged), focus-visible (`Input`'s and `Button`'s built-in focus-visible ring, already present before this change — confirmed via `src/components/ui/input.tsx`, not newly introduced here), disabled (existing disabled states on `Button` during pending mutations, already token-driven, unchanged), error (already handled — `savePauseMutation.error`, `resumeMutation.error`, `startRun.error`, `startServerMutation.error` all render via `text-destructive`, confirmed present and unaffected by this change), empty (N/A — this view has no "no data" empty state; the staging form is always present as the primary content regardless of run-list state), loading (Phase 2's new skeleton for the run-list panels; `rangesQuery`'s loading state intentionally stays silent per its documented fallback-to-defaults design, confirmed as a deliberate choice, not a gap).

**Contract**: No code change — this phase documents and screenshots what Phase 1+2 produced, explicitly re-checking the "error" and "empty" N/A reasoning against each hook's actual behavior rather than against the view's JSX alone.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run check`
- Full suite still passes: `npm test`

#### Manual Verification:

- Screenshot the simulation page at desktop width showing: the staging form (default state), the loading skeleton for run-list panels, and at least one error state (e.g. by triggering a save/resume failure or reading the existing error-rendering code path)
- Screenshot the simulation page at one mobile width (375px) to confirm no layout regression
- Confirm the "empty" state's N/A reasoning above still holds (the staging form is always the primary content)
- Confirm the "error" state's existing coverage (4 distinct mutation error renders) was not affected by this change

## Testing Strategy

### Unit Tests:

- None planned — this is a presentational/accessibility/loading-state fix with no new business logic. `NumberField`'s `Number(e.target.value)` conversion is the same one-line conversion the 12 call sites already did inline; a dedicated unit test would mirror the implementation rather than protect it.

### Manual Testing Steps:

1. Load `/simulation` signed in, confirm all 12 numeric fields render and update correctly through `NumberField`.
2. Start a server run, confirm the run-switcher panel's loading skeleton (if the query is still pending) and then the real "Run #N" button appear correctly.
3. Inspect the accessibility tree (or `document.querySelectorAll('main').length`) to confirm exactly one `main` element.
4. Confirm an existing error path (e.g. a deliberately failing save/resume call) still renders its `text-destructive` message.

## Performance Considerations

None — all changes are presentational; no new queries, no additional network calls.

## Migration Notes

None — no schema or data change.

## References

- `context/changes/staging-live-view-restyle/research.md` — full charge list with file:line evidence.
- `context/archive/2026-11-14-dashboard-restyle/` — the prior S-16 change whose nested-`<main>` and loading-skeleton fixes this plan mirrors, and whose impl-review lesson (recorded in `context/foundation/lessons.md`) this plan's Phase 3 explicitly applies.
- `src/components/ui/input.tsx` — `Input`'s existing focus-visible treatment, reused unchanged by the new `NumberField`.
- Roadmap `context/foundation/roadmap.md` S-17 — the Slice entry this plan implements.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Build the shared NumberField component

#### Automated

- [x] 1.1 Type checking passes: `npm run typecheck` — f3595c6
- [x] 1.2 Linting passes: `npm run check` — f3595c6
- [x] 1.3 Full suite still passes: `npm test` — f3595c6

### Phase 2: Apply the three fixes to the simulation view

#### Automated

- [x] 2.1 Type checking passes: `npm run typecheck`
- [x] 2.2 Linting passes: `npm run check`
- [x] 2.3 Full suite still passes: `npm test`
- [x] 2.4 Hardcoded-value scan on simulation/page.tsx still returns zero hits

#### Manual

- [x] 2.5 All 12 numeric fields render and update correctly through NumberField
- [x] 2.6 Exactly one `main` landmark on the simulation page
- [x] 2.7 Loading skeleton shown before run-list panels appear
- [x] 2.8 Staging form, suggestion card, run-switcher/save/resume all behave as before

### Phase 3: States verification pass

#### Automated

- [ ] 3.1 Type checking passes: `npm run typecheck`
- [ ] 3.2 Linting passes: `npm run check`
- [ ] 3.3 Full suite still passes: `npm test`

#### Manual

- [ ] 3.4 Desktop screenshots: default (staging form), loading skeleton, an error state
- [ ] 3.5 Mobile (375px) screenshot, no layout regression
- [ ] 3.6 Empty-state N/A reasoning still holds
- [ ] 3.7 Existing error-state coverage (4 mutation error renders) unaffected
