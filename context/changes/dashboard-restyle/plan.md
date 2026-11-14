# Restyle the post-login dashboard onto the F-06 design-system contract Implementation Plan

## Overview

Close the four design-system-contract charges found during `/10x-ui dashboard`'s audit (recorded in `research.md`): two missing-shared-component gaps, one accidental-architecture landmark issue, and one real loading-state bug. The dashboard is already token-compliant — no color/spacing literals to fix.

## Current State Analysis

- `src/app/dashboard/page.tsx` is fully token-compliant (hardcoded-value scan: zero hits) — not a missing-tokens case.
- Five `<Link>` elements are manually styled to look like buttons with no `focus-visible` treatment, duplicating classNames that `Button`'s own `asChild` prop (via Radix `Slot`) already exists to absorb (`src/components/ui/button.tsx:7,53`).
- The "select run for comparison" control is a bare `<input type="checkbox">` (`dashboard/page.tsx:159-165`) — no `checkbox.tsx` exists yet in `src/components/ui/`, unlike the already-present `switch.tsx`.
- The page's root `<main>` (`dashboard/page.tsx:65`) is now nested inside `AppShell`'s `SidebarInset`, which is also a `<main>` (`src/components/ui/sidebar.tsx:303-312`) — two nested `main` landmarks, invalid per the HTML landmark model. This recurs sitewide (`simulation/page.tsx`, `runs/[runId]/page.tsx`, `runs/compare/page.tsx`) but is fixed here only for this view, per `/10x-ui`'s one-view-per-change rule.
- `isEmpty` (`dashboard/page.tsx:52-55`) defaults missing query data (`undefined`, during the initial fetch) to `0`, so the empty state ("You haven't started any simulations yet.") renders during the loading state too — a real, user-visible bug for any returning user with existing runs.
- Full evidence and file:line anchors: `context/changes/dashboard-restyle/research.md`.

## Desired End State

The dashboard's five button-like links go through the shared `Button` component (visible keyboard focus ring on every primary action), the comparison control uses a proper `Checkbox` primitive, the page has exactly one `<main>` landmark (owned by `AppShell`), and the page shows a loading skeleton instead of a false empty state while its three queries are in flight. No visual regression to the existing Running/Saved/Completed sections' content or the comparison-selection flow.

### Key Discoveries

- Every fix uses a primitive already present in this repo's design system or reachable via the same CLI path F-06 used (`npx shadcn@latest add <name>`) — no new dependency, no new color/token decision.
- `src/components/ui/skeleton.tsx` already exists (installed as a sidebar transitive dependency in F-06) and can be reused for the loading state without adding anything new.

## What We're NOT Doing

- Not touching `simulation/page.tsx`, `runs/[runId]/page.tsx`, or `runs/compare/page.tsx` — the same nested-`<main>` and link-as-button patterns recur there, but fixing them is S-17/S-18's job when those views get restyled (noted in research.md's Deferred section).
- Not introducing any new color, spacing, or typography token — none is needed; the view is already token-compliant.
- Not changing the underlying tRPC queries (`listRunning`/`listSaved`/`listCompleted`), their polling cadence, or the comparison-selection business logic (`toggleSelected`, `canCompare`) — only the loading/empty-state *rendering* branch changes.
- Not adding a dark-mode-specific pass — this app's `:root`/`.dark` tokens are already identical by existing design (per F-06's plan), unaffected by this change.

## Implementation Approach

Three phases, following `/10x-ui`'s prescribed order (environment/library → view → states): add the missing primitive first, apply all four fixes to the one view, then verify the full 7-state matrix.

## Phase 1: Add the Checkbox primitive

### Overview

Install shadcn's `Checkbox` component, the one piece of environment/library setup this change needs.

### Changes Required:

#### 1. Install the Checkbox primitive

**File**: `src/components/ui/checkbox.tsx` (generated, not hand-written)

**Intent**: Run `npx shadcn@latest add checkbox` to install the official primitive, following the same path F-06 used for `sidebar` — additive, does not modify `globals.css`'s existing tokens or any other `src/components/ui/*.tsx` file.

**Contract**: No new contract — the shadcn CLI's own generated `Checkbox` component API (a controlled `checked`/`onCheckedChange` component wrapping Radix's checkbox primitive).

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run check`
- Full suite still passes: `npm test`

#### Manual Verification:

- (none for this phase — the component isn't used anywhere yet; Phase 2 wires it in)

---

## Phase 2: Apply the four fixes to the dashboard view

### Overview

Edit `src/app/dashboard/page.tsx` only: wrap the five button-like links in `Button asChild`, swap the bare checkbox for the new `Checkbox` component, change the root element from `<main>` to `<div>`, and add a loading-state branch.

### Changes Required:

#### 1. Wrap button-like links in `Button asChild`

**File**: `src/app/dashboard/page.tsx`

**Intent**: Replace each of the five manually-styled `<Link className="...rounded-full...">` elements ("Start a simulation", "View" ×2, "View analysis", "Compare selected" enabled variant, "Start a new simulation") with `<Button asChild variant="..."><Link href="...">...</Link></Button>`, so each inherits the shared component's built-in `focus-visible` ring instead of a duplicated, focus-blind className string. Preserve each link's existing visual weight (e.g. the "Compare selected" link's `bg-foreground/35` emphasis vs. the plainer "View" links) by passing the existing className through `Button`'s `className` prop where the current look doesn't match any existing `Button` variant — `Button`'s `cn()` merge (confirmed in `button.tsx:57`) layers it on top of the base variant classes, so no new variant needs inventing.

**Contract**: No change to `href` targets, click behavior, or the surrounding `disabled` Button already used for the unavailable "Compare selected" state (lines 196-203) — that one already goes through `Button` and is untouched.

#### 2. Replace the bare checkbox with the shared `Checkbox` component

**File**: `src/app/dashboard/page.tsx`

**Intent**: Replace the native `<input type="checkbox" className="size-4 shrink-0">` (lines 159-165) with the Phase 1 `Checkbox` component, preserving its `aria-label`, `checked`, `disabled`, and `onChange`→`onCheckedChange` wiring.

**Contract**: Same selection semantics (`toggleSelected(run.id)` called on change) — only the rendered control changes, not the state it drives.

#### 3. Fix the nested `<main>` landmark

**File**: `src/app/dashboard/page.tsx`

**Intent**: Change the page's root element (line 65) from `<main className="...">` to `<div className="...">` — same className, same visual gradient/layout — since `AppShell`'s `SidebarInset` already renders the page's one correct `<main>` landmark.

**Contract**: No className or layout change — element tag only.

#### 4. Add a loading state

**File**: `src/app/dashboard/page.tsx`

**Intent**: Compute an `isLoading` flag from the three queries' pending state (`runningQuery.isPending || savedQuery.isPending || completedQuery.isPending`) and render a skeleton (using `src/components/ui/skeleton.tsx`) when `isLoading` is true, checked *before* the existing `isEmpty` branch — so a returning user with existing runs never sees the false "You haven't started any simulations yet." message while data is still in flight.

**Contract**: `isEmpty`'s own computation is unchanged (still derived from `?? 0` defaults) — it simply isn't consulted for rendering until all three queries have settled. No change to the queries' `refetchInterval` or any tRPC procedure.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run check`
- Full suite still passes: `npm test`
- Hardcoded-value scan on `src/app/dashboard/page.tsx` still returns zero hits (no literal colors introduced by this phase)

#### Manual Verification:

- Tabbing through the dashboard shows a visible focus ring on every one of the five previously focus-blind links
- The comparison checkbox renders as the themed `Checkbox` component, same check/uncheck/disabled behavior as before
- Browser dev tools' accessibility tree shows exactly one `main` landmark on the dashboard page
- Reloading the dashboard with existing runs present shows a loading skeleton, never the "You haven't started any simulations yet." message, before the real content appears

---

## Phase 3: States verification pass

### Overview

Verify all seven states (default, hover, focus-visible, disabled, error, empty, loading) are either shown correctly or N/A with a reason, and run the visual gate.

### Changes Required:

#### 1. Verify and screenshot the 7-state matrix

**File**: none (verification only, no new code)

**Intent**: Confirm each state: default (token-driven, unchanged), hover (existing `hover:` classes, unchanged), focus-visible (Phase 2's Button-wrapped links + Checkbox, now visible), disabled (existing disabled `Button` state for "Compare selected" when <2 or >4 selected, already token-driven), error (N/A — this view has no form submission or error-producing action; the queries have no distinct error-UI requirement beyond what already exists, confirmed by reading the file: no `isError` branch exists and none is planned, since a query error here would be a backend/observability concern out of this change's scope, not a visual-restyle one), empty (existing empty-state card, now correctly gated behind the loading check from Phase 2), loading (new skeleton from Phase 2).

**Contract**: No code change — this phase documents and screenshots what Phase 1+2 produced.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run check`
- Full suite still passes: `npm test`

#### Manual Verification:

- Screenshot the dashboard at desktop width showing: default state with runs present, the empty-state card (no runs), and the loading skeleton
- Screenshot the dashboard at one mobile width (375px) to confirm no layout regression
- Confirm keyboard Tab order reaches all five previously-focus-blind links/buttons with a visible ring, in a sensible reading order
- Confirm the "error" state's N/A reasoning above still holds (no new error-producing UI was introduced by this change)

## Testing Strategy

### Unit Tests:

- None planned — this is a presentational/accessibility/loading-state fix with no new business logic. The `isLoading` computation is a direct OR of three existing query flags; a dedicated unit test would mirror the one-line implementation rather than protect it.

### Manual Testing Steps:

1. Sign in, load `/dashboard` with at least one existing run, and confirm the loading skeleton appears briefly before content (throttle network in dev tools if the local query resolves too fast to observe).
2. Tab through the page with the keyboard only; confirm every interactive element shows a visible focus ring.
3. Check/uncheck several "Completed" run checkboxes, confirm selection count behavior (2–4 enables "Compare selected") is unchanged.
4. Inspect the accessibility tree (or `document.querySelectorAll('main').length`) to confirm exactly one `main` element.

## Performance Considerations

None — all changes are presentational; no new queries, no additional network calls.

## Migration Notes

None — no schema or data change.

## References

- `context/changes/dashboard-restyle/research.md` — full charge list with file:line evidence.
- `context/archive/2026-11-14-ui-design-system-foundation/plan.md` — the prior change that wired `AppShell`/`SidebarInset`, the source of Charge 3's nested-`<main>` issue.
- `src/components/ui/button.tsx` — `Button`'s `asChild` support this plan relies on for Phase 2.
- Roadmap `context/foundation/roadmap.md` S-16 — the Slice entry this plan implements.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Add the Checkbox primitive

#### Automated

- [x] 1.1 Type checking passes: `npm run typecheck` — cdddbee
- [x] 1.2 Linting passes: `npm run check` — cdddbee
- [x] 1.3 Full suite still passes: `npm test` — cdddbee

### Phase 2: Apply the four fixes to the dashboard view

#### Automated

- [x] 2.1 Type checking passes: `npm run typecheck`
- [x] 2.2 Linting passes: `npm run check`
- [x] 2.3 Full suite still passes: `npm test`
- [x] 2.4 Hardcoded-value scan on dashboard/page.tsx still returns zero hits

#### Manual

- [x] 2.5 Visible focus ring on all five previously focus-blind links
- [x] 2.6 Comparison checkbox renders as themed Checkbox, same behavior
- [x] 2.7 Exactly one `main` landmark on the dashboard page
- [x] 2.8 Loading skeleton shown instead of false empty state

### Phase 3: States verification pass

#### Automated

- [ ] 3.1 Type checking passes: `npm run typecheck`
- [ ] 3.2 Linting passes: `npm run check`
- [ ] 3.3 Full suite still passes: `npm test`

#### Manual

- [ ] 3.4 Desktop screenshots: default (with runs), empty, loading
- [ ] 3.5 Mobile (375px) screenshot, no layout regression
- [ ] 3.6 Keyboard Tab order reaches all five fixed links/buttons with visible ring
- [ ] 3.7 Error-state N/A reasoning still holds
