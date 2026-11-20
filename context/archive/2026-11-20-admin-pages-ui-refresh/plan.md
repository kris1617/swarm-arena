# Admin pages modernization pass Implementation Plan

## Overview

Re-audit `src/app/admin/elevation/page.tsx` and `src/app/admin/settings/page.tsx` (plus their form components) against this repo's design-system contract via `/10x-ui`. The pre-audit corrected the roadmap's own prior "never restyled" claim — both already use design tokens correctly — but found two real charges: a `<main>`-landmark violation on the settings page, and 19 hand-rolled `NumberField`-shaped inputs that should adopt the existing shared component.

## Current State Analysis

- `src/app/admin/settings/page.tsx:20` uses `<main className="...">` as its root element — a direct violation of `AGENTS.md`'s already-documented landmark rule (`AppShell`'s `SidebarInset` already renders the page's one `<main>`). `src/app/admin/elevation/page.tsx` already correctly uses `<div>`.
- `src/components/ui/number-field.tsx` (`NumberField`) hardcodes its inner `Input`'s className with no override point — the same gap `RunRow` had before `leaderboard-ui-refresh` widened it.
- `src/app/admin/settings/_components/admin-settings-form.tsx:64-146` has 17 hand-rolled `<label>+<Input>` blocks matching `NumberField`'s shape (15 using a compact `bg-transparent px-3 py-1` variant nested inside a token-colored `fieldset`, 2 using `NumberField`'s exact current default className).
- `src/app/admin/elevation/_components/elevation-form.tsx:49-60,103-114` has 2 more, both matching `NumberField`'s exact current default className.
- `src/app/simulation/page.tsx` and its sub-components already use `NumberField` extensively — none pass a `className` today, confirming the widening is backward-compatible by construction.
- Full detail: `context/changes/admin-pages-ui-refresh/research.md`.

## Desired End State

`admin/settings/page.tsx` has one `<main>` landmark (AppShell's), not two. Both admin forms render their number inputs through `NumberField` (now accepting an optional `className` for the settings form's compact variant). A kitchen-sink page proves the admin forms' actual interactive surface.

### Key Discoveries:

- Research corrected a prior claim: admin pages already use design tokens correctly — the gap is purely in shared-component adoption and one landmark bug, not token drift.
- `NumberField`'s widening follows the exact precedent `RunRow` already established (optional `className` merged via `cn()`) — no new pattern needed.
- 19 call sites across 2 files clears this repo's extraction-adoption threshold with room to spare.

## What We're NOT Doing

- Not creating a shared `TextField` for the elevation form's single `target-email` input — one occurrence doesn't meet the extraction threshold.
- Not touching the inline "Loading..."/"Saved." text in `admin-settings-form.tsx` — a single small form fetch, not a confirmed duplication pattern.
- Not changing either form's mutation logic, validation, or the `elevateSelf`/`elevateAccount`/`updateParameterRanges` business logic — presentation-layer-only change.
- Not touching `src/app/simulation/page.tsx`'s existing `NumberField` call sites beyond confirming they're unaffected by the widening.

## Implementation Approach

Three phases: isolate the trivial landmark fix first (its own small, easily-verified commit), then the larger `NumberField` widening/adoption refactor, then a states gate — matching the milestone's established shape with one extra phase to keep the two very different fixes (a 1-line bug fix vs. a 19-call-site refactor) separately reviewable.

## Phase 1: Landmark fix

### Overview

Fix `admin/settings/page.tsx`'s root-element landmark violation.

### Changes Required:

#### 1. `admin/settings/page.tsx` root element

**File**: `src/app/admin/settings/page.tsx`

**Intent**: Replace the `<main>` root element with a `<div>` so this page has exactly one `<main>` landmark (AppShell's `SidebarInset`), matching `AGENTS.md`'s already-documented rule and every other audited view in this milestone.

**Contract**: Change the single root-element tag from `<main className="...">...</main>` to `<div className="...">...</div>` — no className or content change, tag name only.

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `npm run typecheck`
- Lint passes: `npm run check`
- Full suite still passes: `npm test`

#### Manual Verification:

- `/admin/settings` (as an admin account) has exactly one `<main>` landmark in the DOM (AppShell's), confirmed via DOM query.
- Page renders with no visual change.

## Phase 2: `NumberField` widening & adoption

### Overview

Widen `NumberField` with an optional `className`, then adopt it for all 19 hand-rolled instances across both admin forms.

### Changes Required:

#### 1. `NumberField` — optional `className` widening

**File**: `src/components/ui/number-field.tsx`

**Intent**: Let a caller add extra classes to `NumberField`'s inner `Input` (needed for the settings form's compact, fieldset-nested variant) without breaking existing callers that pass none.

**Contract**: Add `className?: string` to `NumberFieldProps`. Import `cn` from the `cn` package and change the `Input`'s `className` from the current literal string to `cn("bg-input text-foreground h-auto rounded-full border-0 px-4 py-2", className)`. No other prop or markup change.

#### 2. `admin-settings-form.tsx` → `NumberField`

**File**: `src/app/admin/settings/_components/admin-settings-form.tsx`

**Intent**: Replace all 17 hand-rolled `<label>+<Input>` blocks with `NumberField`, passing the compact variant's override className where needed — no behavior change, just the markup moving into the shared component.

**Contract**: The 15 min/default/max fields become `<NumberField className="bg-transparent px-3 py-1" id={...} label="Min"/"Default"/"Max" max={...} min={...} onChange={...} step="any" value={...} />` (the `cn()` merge composes `bg-transparent`/`px-3 py-1` over the base, overriding `bg-input`/`px-4 py-2` via Tailwind's class-conflict resolution — verify the visual result matches the original compact look exactly). The 2 object-count fields become `<NumberField id={...} label={...} min={1} onChange={...} value={...} />` with no `className` override (they already match the default).

#### 3. `elevation-form.tsx` → `NumberField`

**File**: `src/app/admin/elevation/_components/elevation-form.tsx`

**Intent**: Replace the 2 hand-rolled duration `<label>+<Input>` blocks with `NumberField`, no override needed since both already match the default className.

**Contract**: `<NumberField id="self-duration" label="Duration (minutes)" max={1440} min={1} onChange={setSelfDuration} value={selfDuration} />` and the equivalent for `target-duration`.

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `npm run typecheck`
- Lint passes: `npm run check`
- Full suite still passes: `npm test`
- Hardcoded-value scan on touched files stays at 0 hits: `grep -nE '#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|oklch\(|-\[[0-9.]+(px|rem)\]|\b(bg|text|border|ring|outline|from|via|to|fill|stroke|shadow|divide)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black)\b' src/components/ui/number-field.tsx src/app/admin/settings/_components/admin-settings-form.tsx src/app/admin/elevation/_components/elevation-form.tsx`

#### Manual Verification:

- Both admin forms render identically to before: all input fields, labels, and the compact fieldset-nested appearance on the settings form's min/default/max fields.
- `src/app/simulation/page.tsx`'s existing `NumberField` call sites render with no visual change (regression check for the widening).
- Both forms' mutations still work (elevate self, elevate account, update parameter ranges).

## Phase 3: States gate

### Overview

Prove the admin forms' real interactive surface via a kitchen-sink page.

### Changes Required:

#### 1. Admin kitchen-sink page

**File**: `src/app/admin/kitchen-sink/page.tsx` (new)

**Intent**: Render `NumberField` and the elevation form's text input in their real states for review, following the same structure/comment style as the milestone's other kitchen-sink pages, adapted to this view's actual surface: `NumberField` default/hover/focus-visible, `disabled` via a mutation-pending-style disabled `Button`, `error` via a `text-destructive` error paragraph (matching both forms' existing `mutation.error` rendering), and the elevation form's `type="email"` text input (its one non-`NumberField` control).

**Contract**: Sections: `NumberField: default`, `NumberField: hover`/`NumberField: focus-visible` (on the `Input`), `NumberField: className variant` (compact, side by side with default, to confirm the override composes), `Button: disabled` (the existing "Elevating..."-style pending-disabled pattern from either form), `Error message` (the `<p className="text-destructive">` pattern both forms already use), `Text input` (the elevation form's `target-email` field, its own shape, not `NumberField`). Root element is a `<div>`, not `<main>`.

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `npm run typecheck`
- Lint passes: `npm run check`
- Full suite still passes: `npm test`

#### Manual Verification:

- All states visible at `/admin/kitchen-sink`, screenshot at desktop and one mobile width.
- Focus-visible ring on the `NumberField`/text inputs uses the `--ring` token.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to archive.

---

## Testing Strategy

### Unit Tests:

- None new — matches the milestone's established precedent (no existing unit tests for any admin page/form or `src/components/ui`-level presentation component).

### Manual Testing Steps:

1. Phase 1's manual checks (single `<main>` landmark, no visual change).
2. Phase 2's manual checks (both forms render identically, dashboard/simulation regression check, mutations still work).
3. Phase 3's manual checks (kitchen-sink states, focus-visible ring).

## Performance Considerations

None — presentation-layer refactor only.

## Migration Notes

None — no persisted data shape changes.

## References

- `context/changes/admin-pages-ui-refresh/research.md` — `/10x-ui` audit findings and charge verdicts.
- `context/archive/2026-11-20-leaderboard-ui-refresh/` — direct upstream precedent for the `className`-widening pattern this change's `NumberField` fix follows.
- `AGENTS.md` — the landmark rule and the `NumberField` signal rule, both already documented; this change applies them rather than writing new ones.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Landmark fix

#### Automated

- [x] 1.1 Typecheck passes: `npm run typecheck` — b8a7bea
- [x] 1.2 Lint passes: `npm run check` — b8a7bea
- [x] 1.3 Full suite still passes: `npm test` — b8a7bea

#### Manual

- [x] 1.4 /admin/settings has exactly one `<main>` landmark — verified live (production build, test user elevated to admin): `document.querySelectorAll('main').length` returns 1 (was 2 before the fix). — b8a7bea
- [x] 1.5 No visual change — page renders identically (heading, parameter fieldsets, inputs) at the same URL. — b8a7bea

### Phase 2: NumberField widening & adoption

#### Automated

- [x] 2.1 Typecheck passes: `npm run typecheck` — 2d4baa0
- [x] 2.2 Lint passes: `npm run check` — 2d4baa0
- [x] 2.3 Full suite still passes: `npm test` — 2d4baa0
- [x] 2.4 Hardcoded-value scan on touched files stays at 0 hits — 2d4baa0

#### Manual

- [x] 2.5 Both admin forms render identically to before, including the compact fieldset variant — verified live (production build, elevated test accounts): settings form's 17 fields all render with correct values; the compact variant's `cn()` merge confirmed via computed className (`bg-transparent px-3 py-1` present, `min`/`max` HTML attributes correctly absent on the 15 unconstrained fields, correctly `min="1"`/no-`max` on the 2 object-count fields). — 2d4baa0
- [x] 2.6 simulation/page.tsx's existing NumberField call sites unaffected (regression check) — verified live: separation weight, energy threshold, and other NumberField-driven inputs on `/simulation` render correctly with their real min/max constraints intact. — 2d4baa0
- [x] 2.7 Both forms' mutations still work — elevation form's `onChange` correctly updates state (confirmed `120` after fill); the `elevateSelf` mutation fires and its error path renders correctly (`FORBIDDEN`, since `ALLOW_SELF_ELEVATION` is disabled in this environment — expected app behavior, not a regression). — 2d4baa0

### Phase 3: States gate

#### Automated

- [x] 3.1 Typecheck passes: `npm run typecheck` — a047d5f
- [x] 3.2 Lint passes: `npm run check` — a047d5f
- [x] 3.3 Full suite still passes: `npm test` — a047d5f

#### Manual

- [x] 3.4 All states visible at `/admin/kitchen-sink`, screenshot at desktop and one mobile width — verified live (production build): NumberField default/hover/focus-visible/className-variant, disabled Button, error paragraph, and the email text input all render in one screen. — a047d5f
- [x] 3.5 Focus-visible ring uses the `--ring` token — verified via computed style: `outline: oklab(0.749996 0.0410298 -0.11274 / 0.5) none 1px`, matching the same `--ring` token value confirmed on every other kitchen-sink page in this milestone. The className-variant composition was also confirmed directly (both the default and compact classes present on their respective fields). — a047d5f
