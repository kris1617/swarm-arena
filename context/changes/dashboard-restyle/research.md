---
topic: Dashboard restyle (10x-ui audit) — design-system contract charges for src/app/dashboard/page.tsx
researcher: Claude Sonnet 5
change_id: dashboard-restyle
date: 2026-11-14
last_updated: 2026-11-14
last_updated_by: Claude Sonnet 5
last_updated_note: Initial research
---

# Research: Dashboard restyle — design-system contract charges

## Question

Per `/10x-ui dashboard`'s pre-audit (recorded in `change.md`), what are this view's concrete design-system-contract charges — missing tokens, missing shared components, accidental architecture — each with file:line evidence and user impact, to feed `/10x-plan`?

## Summary

`src/app/dashboard/page.tsx` is already fully token-compliant (the hardcoded-value scan returned zero hits) — this is NOT a missing-tokens case. Four charges found, none about color/spacing literals: two missing-shared-component gaps (no focus-visible ring on 5 link-styled-as-button elements; no shared `Checkbox` primitive for the comparison selector), one accidental-architecture issue (a nested `<main>` landmark, now present because F-06's `AppShell`/`SidebarInset` also renders a `<main>`, sitewide across every authenticated page but fixed here only for this view), and one real state-handling bug (the empty state renders during the initial loading state, before query data arrives, which is user-visible and misleading).

## Charges

### Charge 1 — Five Links styled as buttons have no focus-visible treatment

- **File:evidence**: `src/app/dashboard/page.tsx:91-94` ("Start a simulation"), `:114-120` ("View", Running section), `:134-140` ("View", Saved section), `:178-184` ("View analysis", Completed section), `:187-194` ("Compare selected", enabled-link variant), `:211-216` ("Start a new simulation")
- **Category**: Missing shared component
- **Evidence**: Each of these is a bare `<Link className="...rounded-full px-N py-N font-semibold...">` with `hover:` classes but no `focus-visible:` class anywhere. Compare `src/components/ui/button.tsx:7` (`buttonVariants` base class includes `focus-visible:border-ring focus-visible:ring-ring/50 ... focus-visible:ring-3`) — the shared `Button` component the page already imports and uses for the filter pills (lines 69-78) and the disabled "Compare selected" state (lines 196-203) gets this for free; the manually-styled Links do not.
- **User impact**: A keyboard user tabbing through the dashboard sees no visible focus indicator on any of these 5 primary actions — "Start a simulation", "View" (×2), "View analysis", "Compare selected", "Start a new simulation" — making keyboard navigation effectively unusable on the dashboard's main actions.
- **Fix**: `Button`'s own `asChild` prop (via Radix `Slot`, confirmed in `button.tsx:53`) exists exactly for this: wrap each with `<Button asChild variant="..."><Link href="...">...</Link></Button>` instead of a bare styled `Link`, inheriting the real focus-visible ring, hover, and transition treatment from one source instead of duplicating classNames five times.

### Charge 2 — No shared Checkbox component for the comparison selector

- **File:evidence**: `src/app/dashboard/page.tsx:159-165` — `<input aria-label={...} checked={isSelected} className="size-4 shrink-0" disabled={selectionDisabled} onChange={...} type="checkbox" />`
- **Category**: Missing shared component
- **Evidence**: `src/components/ui/` contains `button.tsx`, `input.tsx`, `separator.tsx`, `sheet.tsx`, `sidebar.tsx`, `skeleton.tsx`, `switch.tsx`, `tooltip.tsx` — no `checkbox.tsx`. The page already uses a design-system `Switch` elsewhere in the app (the simulation staging form's "Crossbreeding enabled" control, confirmed present in `src/components/ui/switch.tsx`), so this repo's shadcn setup is already configured for form-control primitives; checkbox is simply not yet added.
- **User impact**: The comparison checkbox has no token-driven focus-visible ring (browser default outline only, inconsistent with the rest of the app's `--ring` token), no themed checked/disabled state, and no consistent sizing contract with the rest of the design system.
- **Fix**: `npx shadcn@latest add checkbox` (same CLI path F-06 used for `sidebar`), then replace the bare `<input type="checkbox">` with the generated `Checkbox` component.

### Charge 3 — Nested `<main>` landmark (sitewide, fixed here for this view)

- **File:evidence**: `src/app/dashboard/page.tsx:65` (`<main className="from-primary to-background ...">`) rendered inside `src/components/ui/sidebar.tsx:303-312`'s `SidebarInset`, which is itself a `<main className="bg-background relative flex w-full flex-1 flex-col ...">` (confirmed by reading `SidebarInset`'s implementation).
- **Category**: Accidental architecture
- **Evidence**: Since F-06 wired `AppShell` into `RootLayout` for every authenticated page (`src/app/layout.tsx:31`), every such page's own root `<main>` element is now nested inside `AppShell`'s `SidebarInset`, which is also a `<main>`. Two nested `<main>` landmarks on one page is invalid per the HTML landmark model (assistive tech expects exactly one `main` per document). Confirmed the same pattern recurs verbatim in `src/app/simulation/page.tsx:221`, `src/app/runs/[runId]/page.tsx:55,63,97`, and `src/app/runs/compare/page.tsx:92,100,108,133` — this is a sitewide consequence of F-06, not unique to the dashboard, but S-16 is the first view actually being restyled, so the fix lands here; S-17 (`staging-live-view-restyle`) and S-18 (`analysis-comparison-restyle`) will need the identical fix when they touch `simulation/page.tsx` and the `runs/*` pages respectively.
- **User impact**: Screen-reader users navigating by landmark region see two "main" regions instead of one, which is confusing navigation structure, not a visual defect.
- **Fix**: Change the dashboard's own root element from `<main>` to `<div>` (keeping the same className/background-gradient styling); the single `<main>` landmark is now correctly owned by `AppShell`'s `SidebarInset`.

### Charge 4 — Empty state renders during the loading state, before data arrives

- **File:evidence**: `src/app/dashboard/page.tsx:52-55` (`isEmpty` computed from `?? 0` defaults on all three queries) and `:82` (`{isEmpty ? <empty-state> : <sections>}`)
- **Category**: State-handling bug (7-state matrix: "loading" vs "empty" are conflated)
- **Evidence**: `runningQuery`, `savedQuery`, `completedQuery` (lines 42-50) are tRPC/React Query hooks; while any of them is in its initial fetch, `.data` is `undefined`, and `isEmpty`'s `(x.data?.length ?? 0) === 0` treats `undefined` identically to an empty array. No `isLoading`/`isPending`/`isFetching` check exists anywhere in the file (confirmed via grep — zero matches for `isLoading|isPending`).
- **User impact**: A returning user with existing runs sees "You haven't started any simulations yet." flash on screen for the duration of the initial query round-trip, before their actual runs render — a false, briefly-misleading empty state on every dashboard visit, not just first-time users.
- **Fix**: Add a `loading` state (gate `isEmpty`'s branch on all three queries having settled — `runningQuery.isPending || savedQuery.isPending || completedQuery.isPending` — and render a skeleton, e.g. using the `skeleton.tsx` primitive already in `src/components/ui/`, instead of either the empty state or the real content while any query is still pending).

## Deferred (noted, not fixed in this change)

- The nested-`<main>` pattern (Charge 3) recurs in `simulation/page.tsx`, `runs/[runId]/page.tsx`, and `runs/compare/page.tsx` — out of scope here per 10x-ui's "one view per change" rule. S-17 and S-18 should apply the identical `<main>` → `<div>` fix when they restyle those views. Worth a `/10x-lesson` entry once S-17/S-18 confirm the pattern.
- The manually-styled-Link-as-button pattern (Charge 1) likely also recurs in `simulation/page.tsx` and `runs/*` pages (not grepped exhaustively here, out of scope for this view-scoped change).

## Code References

- `src/app/dashboard/page.tsx:1-220` — the full view under audit.
- `src/components/ui/button.tsx:1-66` — `Button`'s `asChild` support and built-in focus-visible/disabled treatment.
- `src/components/ui/sidebar.tsx:303-312` — `SidebarInset`'s own `<main>` element, the source of Charge 3.
- `src/app/layout.tsx:31` — where `AppShell` (and therefore `SidebarInset`) gets mounted for every authenticated page.
- `AGENTS.md` (`## UI` section) — current, no-literal-colors rule already in force; no rule update needed by this change (no missing-tokens charge).

## Open Questions

None — all four charges have concrete, unambiguous fixes using primitives already present in this repo's design system (no new dependency, no new palette decision).
