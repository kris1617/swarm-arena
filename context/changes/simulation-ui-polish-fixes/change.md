---
change_id: simulation-ui-polish-fixes
title: Fix dropdown contrast and simulation watch-window sizing
status: implemented
created: 2026-11-20
updated: 2026-11-20
archived_at: null
---

## Notes

Two UI bugs reported directly by the user, fixed ad hoc (small, isolated,
root-caused live) rather than through the full plan cycle, then recorded
here for the audit trail. Both deployed and verified on real CI/production
infrastructure.

## Bug 1: Dropdown `<option>` white text on white background

**Report**: "dropdowns show white text on white background unless highlighted"

**Root cause** (confirmed via computed-style inspection, not guessed):
`src/components/ui/select.tsx` themes only the closed `<select>` trigger
(`bg-input text-foreground`). The `<option>` popup is rendered by the
browser/OS outside the normal CSS cascade — unstyled options inherited
`text-foreground`'s light color over a transparent background
(`optBg: rgba(0,0,0,0)`, `optColor: white`), rendering white-on-white until
the browser's own hover highlight made a row visible by coincidence.

**Fix**: one global CSS rule in `src/styles/globals.css`'s `@layer base`:
```css
select option {
	background-color: var(--popover);
	color: var(--popover-foreground);
}
```
Reuses the same tokens every other floating surface in this app already
uses. Verified via computed styles before (`optBg: rgba(0,0,0,0)`) and
after (`optBg: lab(12.49...)`, matching `--popover`'s dark purple).

**Commit**: `3e3b503` — deployed, verified green (`44767205165`).

## Bug 2: Simulation watch window too small

**Report**: "when I press start I think parameter view and simulation
watch window overlap and it does not look good"

**Investigation**: swept 8 viewport widths (360-1920px) with an active run,
checking both full-page screenshots and precise bounding-box intersection
between the canvas, Suggestion panel, and Live-parameters panel — found
zero DOM-level overlap at any width. User then reframed the ask directly:
"Ok do Just make Simulation View window Bigger."

**Root cause** (confirmed via computed-style/rect inspection, not guessed):
`SimulationCanvas`'s own root div (`src/app/simulation/_components/
simulation-canvas.tsx`) had no width class (`flex flex-col items-center
gap-4`). Nested inside the page's own `items-center` flex-column, it
shrink-wrapped to its own content's intrinsic width via a circular sizing
resolution — every child's `w-full max-w-2xl` never actually had a
properly-sized containing block to resolve its percentage width against,
landing at a fixed ~602px regardless of the `max-w-*` value. Confirmed:
bumping `max-w-2xl` → `max-w-4xl` on the three child divs alone had zero
measured effect (still 602px) until the root div itself got
`w-full max-w-4xl`, after which it correctly grew to 896px.

**Fix**: `w-full max-w-4xl` added to the component's root div; the three
existing child `max-w-2xl` classes bumped to `max-w-4xl` to match (canvas
wrapper, minimap/switches row, Live-parameters panel).

**Commits**: `4eceaa7` (the fix) — deployed, verified green (`44769451342`).
A follow-up investigation confirmed the fix does NOT require regenerating
`tests/e2e/visual-regression.spec.ts`'s `/simulation` baseline, because
that test only visits the pre-start config form and never starts a run —
it never exercises the resized canvas at all. Noted as a real (separate,
unaddressed) coverage gap: the visual-regression suite doesn't currently
cover the actual watch-window view.

## What's genuinely still open

- The visual-regression suite's `/simulation` test only covers the
  pre-start form, not the actual watch-window/canvas view this fix
  changed — a real coverage gap, not acted on unless requested.
