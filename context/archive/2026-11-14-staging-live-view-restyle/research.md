---
topic: Simulation staging/live-view restyle (10x-ui audit) — design-system contract charges for src/app/simulation/page.tsx
researcher: Claude Sonnet 5
change_id: staging-live-view-restyle
date: 2026-11-14
last_updated: 2026-11-14
last_updated_by: Claude Sonnet 5
last_updated_note: Initial research
---

# Research: Simulation staging/live-view restyle — design-system contract charges

## Question

Per `/10x-ui simulation`'s pre-audit (recorded in `change.md`), what are this view's concrete design-system-contract charges — missing tokens, missing shared components, accidental architecture — each with file:line evidence and user impact, to feed `/10x-plan`?

## Summary

`src/app/simulation/page.tsx` and its subcomponents are already in notably better shape than the dashboard was before its own restyle (S-16): zero hardcoded-value scan hits, all four mutation error states already rendered via the `destructive` token, and consistent use of the shared `Input`/`Switch`/`Button` components throughout. Three charges found: the same sitewide nested-`<main>` landmark issue dashboard-restyle's research flagged as expected to recur here (now confirmed), a missing shared form-field component (12 near-identical hand-assembled label+input blocks), and a minor loading-state gap for the running/saved run lists.

## Charges

### Charge 1 — Nested `<main>` landmark

- **File:evidence**: `src/app/simulation/page.tsx:221` — `<main className="from-primary to-background text-foreground flex min-h-screen flex-col items-center justify-center gap-8 bg-gradient-to-b p-8">`, rendered inside `AppShell`'s `SidebarInset` (`src/components/ui/sidebar.tsx:303-312`), which is itself a `<main>`.
- **Category**: Accidental architecture
- **Evidence**: Identical pattern to dashboard-restyle's Charge 3 (fixed in `context/archive/2026-11-14-dashboard-restyle/`), which explicitly deferred this exact file as a known recurrence. Confirmed unchanged since that research.
- **User impact**: Screen-reader users navigating by landmark region see two "main" regions on the simulation page, same as the dashboard had before its fix.
- **Fix**: Change the page's root element from `<main>` to `<div>` — same className, same visual layout — identical to dashboard-restyle's Charge 3 fix.

### Charge 2 — 12 hand-assembled label+input blocks instead of a shared form-field component

- **File:evidence**: `src/app/simulation/page.tsx:338-514` — twelve near-identical blocks of the shape `<label className="flex flex-col gap-1" htmlFor="..."><Input className="bg-input text-foreground h-auto rounded-full border-0 px-4 py-2" id="..." max={...} min={...} onChange={...} type="number" value={...} /></label>`, each differing only in the label text, `id`, `min`/`max`/`step` bounds, and the `onChange`/`value` pair.
- **Category**: Missing shared component
- **Evidence**: This is the audit's own named example of the pattern ("copy-pasted form field"). All 12 blocks share the exact same `className` string and `<label>`/`<Input>` structure — any future change to the numeric-field's look (e.g. adding a visible error state for an out-of-range value, or adjusting spacing) requires 12 synchronized edits instead of one.
- **User impact**: Not yet user-visible (the 12 fields render identically today), but every future touch to this form's field styling carries a 12x duplication-drift risk — exactly the kind of accumulation that produced dashboard's own literal-className duplication before its restyle.
- **Fix**: Extract a `NumberField` component (in `src/components/ui/` or a page-local `_components/` file, implementer's call at `/10x-plan`) taking `label`, `id`, `min`, `max`, `step?`, `value`, `onChange`, wrapping the existing `<label>`+`<Input>` pair with the existing className. Replace all 12 call sites; no visual change.

### Charge 3 — No loading indicator for the running/saved server-run lists

- **File:evidence**: `src/app/simulation/page.tsx:232` (`{runningRunsQuery.data && runningRunsQuery.data.length > 0 ? ... : null}`) and `:270` (`{savedRunsQuery.data && savedRunsQuery.data.length > 0 ? ... : null}`).
- **Category**: State-handling gap (7-state matrix: "loading" state absent)
- **Evidence**: Both sections render `null` while their query is in its initial `isPending` state (same `undefined`-data-is-falsy pattern dashboard-restyle fixed, but milder here — no misleading message is shown, the sections simply don't appear yet). No `isPending`/`isLoading` check exists in the file for either query.
- **User impact**: Less severe than dashboard's equivalent bug (Charge 4 there) — a returning user with running/saved simulations sees the staging form appear first, then the running/saved panels pop in a moment later, with no skeleton or indication that more content is still loading. Not misleading, but a visible layout shift.
- **Fix**: Optional — lower priority than Charges 1 and 2. If addressed, reuse the `Skeleton` component (same one dashboard-restyle used) for a brief loading placeholder above the form while either query is pending. `/10x-plan` should decide whether this is in-scope for this change or deferred, given its lower severity relative to Charges 1/2.

## Deferred (noted, not evaluated further here)

- None beyond what Charge 3 itself flags as optional — `/10x-plan` decides its disposition.
- `runs/[runId]/page.tsx` and `runs/compare/page.tsx` still carry the same nested-`<main>` pattern (confirmed in dashboard-restyle's research) — out of scope for this view-scoped change; S-18 (`analysis-comparison-restyle`) will need the identical fix.

## Code References

- `src/app/simulation/page.tsx:1-545` — the full view under audit.
- `src/app/simulation/_components/server-run-viewer.tsx:1-71` — already clean (shared `Button`, token-driven connecting/error states, root is a `<div>` not `<main>`), no charges.
- `src/app/simulation/_components/simulation-canvas.tsx` — `colorToCss`'s `rgb(...)` output is runtime boid-genome color data, not a design-token violation (per `AGENTS.md`'s existing canvas-color carve-out); no charge.
- `src/components/ui/input.tsx` — confirmed `Input` already has built-in `focus-visible` treatment (`focus-visible:border-ring focus-visible:ring-ring/50 ... focus-visible:ring-3`), so no focus-visible charge exists for this view (unlike dashboard's bare-Link problem).
- `context/archive/2026-11-14-dashboard-restyle/research.md` — source of the nested-`<main>` pattern's sitewide confirmation and the `Skeleton` component reused by Charge 3's optional fix.
- `AGENTS.md` (`## UI` section) — current; the link-as-button and main-landmark rules dashboard-restyle added already cover this change's Charge 1, no further rule update needed unless Charge 2's `NumberField` component is added (which would warrant a one-line mention in the rules file).

## Open Questions

- Whether Charge 3 (loading indicator for run lists) is in-scope for this change or deferred — lower severity than Charges 1/2, `/10x-plan` should resolve with the user given it's the one charge without an unambiguous "must fix" case.
