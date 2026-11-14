# Restyle the run-analysis and run-comparison pages onto the F-06 design-system contract Implementation Plan

## Overview

Close the four design-system-contract charges found during `/10x-ui runs`'s audit (recorded in `research.md`), across both `runs/[runId]/page.tsx` and `runs/compare/page.tsx`: give the repo's long-unused `--chart-1`..`5` tokens real hue (reusing `PHASE_COLORS`' existing 5 semantic colors) and have both views reference them instead of local hex constants; fix the sitewide nested-`<main>` landmark issue across all 7 early-return branches in these two files; fix two focus-blind export links; and extract a shared `StatusMessage` component for the 6 duplicated loading/error/empty shells.

## Current State Analysis

- `src/styles/globals.css:85-89,121-125` defines `--chart-1`..`5` as a pure grayscale ramp (`oklch(<L> 0 0)`, zero chroma) in both `:root` and `.dark` — unused anywhere in the codebase until this change.
- `runs/[runId]/page.tsx:19-25`'s `PHASE_COLORS` (5 hex values, one per `PopulationPhase`) and `runs/compare/page.tsx:24`'s `RUN_COLORS` (4 hex values) are local, hardcoded chart-series colors — confirmed, via the planning interview, that the user wants `--chart-1`..`5` upgraded to carry this exact palette rather than leaving the colors as local constants.
- `runs/[runId]/page.tsx` has 3 separate `<main>`-rooted branches (lines 55, 63, 97); `runs/compare/page.tsx` has 4 (lines 92, 100, 108, 133) — all 7 need the same `<main>`→`<div>` fix S-16/S-17 already established, since `AppShell`'s `SidebarInset` owns the one correct landmark.
- `runs/[runId]/page.tsx:104-115`'s "Export JSON"/"Export CSV" links have no `focus-visible` treatment — the same gap S-16's Charge 1 fixed for the dashboard.
- 6 early-return branches across both files (3 in each) duplicate the identical `<main className="from-primary to-background...">`+`<p>` status shell, differing only in message text.
- Full evidence and file:line anchors: `context/changes/analysis-comparison-restyle/research.md`.

## Desired End State

`--chart-1`..`5` carry real, semantically meaningful hues (gray/green/amber/red/blue, matching `PHASE_COLORS`' existing mapping) in both `:root` and `.dark`. Both views reference these tokens instead of local hex arrays. Every one of the 7 page-root elements across both files is a `<div>`, with `AppShell`'s `SidebarInset` as the sole `<main>` landmark. The two export links go through `Button asChild` for a visible focus ring. All 6 loading/error/empty branches render through one shared `StatusMessage` component. No change to either page's data-fetching, chart data shape, or comparison logic.

### Key Discoveries

- Recharts' `stroke`/`fill` props and the inline `style.backgroundColor` in the phase-tally list all need literal CSS color strings, not Tailwind classes — `"var(--chart-1)"` (referencing the CSS custom property directly) is the correct form here, not a Tailwind `fill-chart-1`-style class, since these are React prop values passed to SVG attributes and inline styles, not `className` strings.
- `PHASE_COLORS`' phase order (establishment, growth, overshoot, crash, recovery) maps directly onto `--chart-1` through `--chart-5` in that same order; `RUN_COLORS`' 4 colors (recovery's blue, growth's green, overshoot's amber, crash's red, in that cycling order) map onto `--chart-5`, `--chart-2`, `--chart-3`, `--chart-4` respectively — reusing the same 5-token identity rather than inventing a second mapping.
- `StatusMessage` is a genuinely reusable composite (a centered message in the page's gradient shell), not a one-off — belongs in `src/components/ui/` alongside `NumberField` (S-17's own precedent for a page-specific-but-shared composite).

## What We're NOT Doing

- Not changing either page's chart *data* (the `chartData`/`phaseTally`/`comparisonQuery` computation), the Recharts chart types (`LineChart`/`BarChart`), or any tRPC query/procedure.
- Not touching `dashboard/page.tsx` or `simulation/page.tsx` — already restyled by S-16/S-17.
- Not adding a dark/light theme distinction to the new chart token values — this app's `:root`/`.dark` stay identical by existing design (per F-06's precedent), so both get the same 5 hues.
- Not extending `StatusMessage` beyond what these 6 call sites need (a message and the existing shell styling) — no new props for icons, actions, or variants unless a future change needs them.

## Implementation Approach

Four phases, following `/10x-ui`'s prescribed order (environment/library → token values → one view → states), split per-view for reviewability since two views are in scope: give the chart tokens real hue and build the shared `StatusMessage` component first, then fix each view in its own phase, then verify states across both.

## Phase 1: Update chart tokens and add the shared StatusMessage component

### Overview

Replace `--chart-1`..`5`'s grayscale values with `PHASE_COLORS`' existing 5 hues in both `:root` and `.dark`, and build a small shared component for the duplicated status-message shell.

### Changes Required:

#### 1. Give `--chart-1`..`5` real hue

**File**: `src/styles/globals.css`

**Intent**: Replace the 5 grayscale `--chart-N` values (lines 85-89, repeated identically at 121-125 for `.dark`) with `PHASE_COLORS`' existing palette, in phase order: `--chart-1` = establishment's gray (`#9ca3af`), `--chart-2` = growth's green (`#22c55e`), `--chart-3` = overshoot's amber (`#f59e0b`), `--chart-4` = crash's red (`#ef4444`), `--chart-5` = recovery's blue (`#38bdf8`). Same values in both `:root` and `.dark`, matching this app's existing single-theme precedent.

**Contract**: No change to the `@theme inline` publishing block (`--color-chart-1: var(--chart-1)` etc. at lines 24-28) — only the underlying `:root`/`.dark` values change, same as any other token update.

#### 2. Add the StatusMessage component

**File**: `src/components/ui/status-message.tsx` (new file)

**Intent**: A small component rendering the shared loading/error/empty shell (`<div className="from-primary to-background text-foreground flex min-h-screen flex-col items-center justify-center bg-gradient-to-b p-8"><p>{children}</p></div>`) — note the root is a `<div>`, not `<main>`, consistent with Phase 2/3's landmark fix. Takes `children: React.ReactNode` for the message content.

**Contract**: `export function StatusMessage({ children }: { children: React.ReactNode })`. Not yet used anywhere in this phase — Phases 2 and 3 replace the 6 duplicated blocks with it.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run check`
- Full suite still passes: `npm test`

#### Manual Verification:

- (none for this phase — the new token values aren't referenced yet and `StatusMessage` isn't used anywhere; Phases 2/3 wire both in)

---

## Phase 2: Apply the fixes to the run-analysis view

### Overview

Edit `src/app/runs/[runId]/page.tsx` only: use the chart tokens for `PHASE_COLORS`, fix the 3 `<main>` roots, fix the 2 export links, and replace the 2 status branches with `StatusMessage`.

### Changes Required:

#### 1. Reference chart tokens instead of local hex values

**File**: `src/app/runs/[runId]/page.tsx`

**Intent**: Replace `PHASE_COLORS`' 5 literal hex values (lines 19-25) with `"var(--chart-1)"` through `"var(--chart-5)"` in phase order, and replace the `Line`'s `stroke="#38bdf8"` (line 131, the population chart's line color) with `"var(--chart-5)"` (recovery's blue, matching the same identity).

**Contract**: No change to `PHASE_COLORS`' type (`Record<PopulationPhase, string>`) or to where it's consumed (`PhaseDot`'s `fill` prop, the phase-tally list's inline `backgroundColor` style) — only the string values change from hex to `var(--chart-N)`.

#### 2. Fix the 3 nested `<main>` landmarks

**File**: `src/app/runs/[runId]/page.tsx`

**Intent**: Change all 3 page-root elements (the loading branch at line 55, the error branch at line 63, and the main-content branch at line 97) from `<main className="...">` to `<div className="...">` — same classNames, same visual layout.

**Contract**: Element tag only; no className or structural change.

#### 3. Replace the loading/error branches with StatusMessage

**File**: `src/app/runs/[runId]/page.tsx`

**Intent**: Replace the loading branch's `<main>...<p>Loading…</p></main>` and the error branch's `<main>...<p>Could not load this run's analysis.</p></main>` with `<StatusMessage>Loading…</StatusMessage>` and `<StatusMessage>Could not load this run&apos;s analysis.</StatusMessage>` respectively.

**Contract**: Same message text, same early-return structure — only the wrapping markup is now shared rather than duplicated.

#### 4. Fix the export links' missing focus-visible treatment

**File**: `src/app/runs/[runId]/page.tsx`

**Intent**: Wrap "Export JSON" and "Export CSV" (lines 104-109, 110-115) in `<Button asChild className="...">`, passing the existing className through, same pattern S-16/S-17 established.

**Contract**: Same `href` targets (`/api/runs/${runId}/export?format=json` / `...=csv`), same link text — only the wrapping element changes.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run check`
- Full suite still passes: `npm test`
- Hardcoded-value scan on `runs/[runId]/page.tsx` returns zero hits (the `var(--chart-N)` strings are not hex/rgb/palette-class literals, so the scan's regex should no longer match this file)

#### Manual Verification:

- The population chart's line and the phase-tally dots render in the same 5 colors as before (gray/green/amber/red/blue), now sourced from `--chart-1`..`5`
- Loading and error states render identically to before through `StatusMessage`
- Browser dev tools' accessibility tree shows exactly one `main` landmark in each of the 3 page states (loading, error, content)
- Tabbing to "Export JSON"/"Export CSV" shows a visible focus ring on both

---

## Phase 3: Apply the fixes to the run-comparison view

### Overview

Edit `src/app/runs/compare/page.tsx` only: use the chart tokens for `RUN_COLORS`, fix the 4 `<main>` roots, and replace the 3 status branches with `StatusMessage`.

### Changes Required:

#### 1. Reference chart tokens instead of local hex values

**File**: `src/app/runs/compare/page.tsx`

**Intent**: Replace `RUN_COLORS`' 4 literal hex values (line 24) with `["var(--chart-5)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)"]` — the same 4 colors (blue, green, amber, red), now sourced from the same token identities `runs/[runId]/page.tsx` uses for recovery/growth/overshoot/crash.

**Contract**: No change to `RUN_COLORS`' type (`string[]`) or to how it's indexed (`RUN_COLORS[index % RUN_COLORS.length]` in the `Bar`'s `fill` prop) — only the string values change.

#### 2. Fix the 4 nested `<main>` landmarks

**File**: `src/app/runs/compare/page.tsx`

**Intent**: Change all 4 page-root elements (no-ids branch at line 92, loading branch at line 100, error branch at line 108, main-content branch at line 133) from `<main className="...">` to `<div className="...">` — same classNames, same visual layout.

**Contract**: Element tag only; no className or structural change.

#### 3. Replace the loading/error/no-ids branches with StatusMessage

**File**: `src/app/runs/compare/page.tsx`

**Intent**: Replace all 3 of the no-ids, loading, and error branches' `<main>...<p>Could not load this comparison.</p></main>` / `<p>Loading…</p>` shells with `<StatusMessage>` wrapping the same existing message text (note: the no-ids and error branches currently show the identical "Could not load this comparison." text — kept as-is, not merged or distinguished, since that's a pre-existing condition outside this change's scope per its research).

**Contract**: Same message text per branch, same early-return structure.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run check`
- Full suite still passes: `npm test`
- Hardcoded-value scan on `runs/compare/page.tsx` returns zero hits

#### Manual Verification:

- The factor-breakdown bar chart renders its run-colored bars in the same 4 colors as before, now sourced from `--chart-5/2/3/4`
- All 3 status branches (no-ids, loading, error) render identically to before through `StatusMessage`
- Browser dev tools' accessibility tree shows exactly one `main` landmark in each of the 4 page states

---

## Phase 4: States verification pass

### Overview

Verify all seven states across both views, explicitly re-checking "error"/"empty" reasoning against each view's actual query hooks (per the lesson recorded from dashboard-restyle's impl-review), and run the visual gate.

### Changes Required:

#### 1. Verify and screenshot the 7-state matrix for both views

**File**: none (verification only, no new code)

**Intent**: Confirm each state for both views: default (chart + data rendered, token-driven colors), hover (Recharts' own tooltip, already token-styled via `bg-popover`-equivalent defaults — unaffected by this change), focus-visible (the two fixed export links, plus any pre-existing `Button`/`Link` elements unaffected by this change), disabled (N/A for both views — neither has a disableable control), error (already handled — both views' `isError` branches now render via `StatusMessage`, confirmed present and functionally unchanged), empty (already handled — `runs/[runId]/page.tsx`'s "No population data recorded"/"No phase data recorded"/"No completed...cycles" messages and `runs/compare/page.tsx`'s "Could not load this comparison" for `okRows.length === 0`, all unaffected by this change, confirmed by reading each query's actual pending/error/empty-data handling rather than assuming from JSX alone), loading (both views' existing `isPending` branches, now rendering via `StatusMessage`, unaffected).

**Contract**: No code change — this phase documents and screenshots what Phases 1-3 produced.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run check`
- Full suite still passes: `npm test`

#### Manual Verification:

- Screenshot both views at desktop width showing: default state with real chart data, a loading state, and an error/empty state
- Screenshot both views at one mobile width (375px) to confirm no layout regression
- Confirm the "disabled" state's N/A reasoning holds for both views
- Confirm existing empty-data messages (population/phase/cycles on the analysis page) are unaffected by this change

## Testing Strategy

### Unit Tests:

- None planned — this is a presentational/token/accessibility fix with no new business logic. `StatusMessage` is a one-line wrapper; a dedicated unit test would mirror the implementation rather than protect it.

### Manual Testing Steps:

1. Complete a run, open its analysis page, confirm the population chart and phase-tally colors match the pre-change palette exactly (visual spot-check against a before/after screenshot).
2. Open the comparison page with 2+ completed runs, confirm the factor-breakdown bar chart's colors match the pre-change palette.
3. Trigger each view's loading/error/empty paths (slow network, invalid run id, missing `ids` param) and confirm `StatusMessage` renders the same text as before.
4. Inspect the accessibility tree (or `document.querySelectorAll('main').length`) on both views, across their loading/error/content states, to confirm exactly one `main` element each time.
5. Tab to "Export JSON"/"Export CSV" and confirm a visible focus ring.

## Performance Considerations

None — all changes are presentational/token values; no new queries, no additional network calls.

## Migration Notes

None — no schema or data change. `globals.css`'s chart-token value change affects only these two views today (confirmed: no other file references `--chart-N` yet), so no other page's appearance changes.

## References

- `context/changes/analysis-comparison-restyle/research.md` — full charge list with file:line evidence and the chart-color decision record.
- `context/archive/2026-11-14-dashboard-restyle/` and `context/archive/2026-11-14-staging-live-view-restyle/` — the prior S-16/S-17 changes whose `<main>`→`<div>` and `Button asChild` fixes this plan reuses verbatim.
- `context/foundation/lessons.md` — the states-matrix-N/A lesson this plan's Phase 4 explicitly applies.
- Roadmap `context/foundation/roadmap.md` S-18 — the Slice entry this plan implements.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Update chart tokens and add the shared StatusMessage component

#### Automated

- [x] 1.1 Type checking passes: `npm run typecheck` — 4fe19fd
- [x] 1.2 Linting passes: `npm run check` — 4fe19fd
- [x] 1.3 Full suite still passes: `npm test` — 4fe19fd

### Phase 2: Apply the fixes to the run-analysis view

#### Automated

- [x] 2.1 Type checking passes: `npm run typecheck`
- [x] 2.2 Linting passes: `npm run check`
- [x] 2.3 Full suite still passes: `npm test`
- [x] 2.4 Hardcoded-value scan on runs/[runId]/page.tsx returns zero hits

#### Manual

- [x] 2.5 Population chart and phase-tally colors match the pre-change palette, now via --chart tokens
- [x] 2.6 Loading/error states render identically through StatusMessage
- [x] 2.7 Exactly one `main` landmark in each of the 3 page states
- [x] 2.8 Visible focus ring on both export links

### Phase 3: Apply the fixes to the run-comparison view

#### Automated

- [ ] 3.1 Type checking passes: `npm run typecheck`
- [ ] 3.2 Linting passes: `npm run check`
- [ ] 3.3 Full suite still passes: `npm test`
- [ ] 3.4 Hardcoded-value scan on runs/compare/page.tsx returns zero hits

#### Manual

- [ ] 3.5 Factor-breakdown bar chart colors match the pre-change palette, now via --chart tokens
- [ ] 3.6 All 3 status branches render identically through StatusMessage
- [ ] 3.7 Exactly one `main` landmark in each of the 4 page states

### Phase 4: States verification pass

#### Automated

- [ ] 4.1 Type checking passes: `npm run typecheck`
- [ ] 4.2 Linting passes: `npm run check`
- [ ] 4.3 Full suite still passes: `npm test`

#### Manual

- [ ] 4.4 Desktop screenshots: default, loading, error/empty for both views
- [ ] 4.5 Mobile (375px) screenshots for both views, no layout regression
- [ ] 4.6 Disabled-state N/A reasoning holds for both views
- [ ] 4.7 Existing empty-data messages on the analysis page unaffected
