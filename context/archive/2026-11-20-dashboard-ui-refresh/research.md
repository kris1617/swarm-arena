---
date: 2026-11-20T04:20:22+01:00
researcher: Claude Sonnet 5
git_commit: 6b175a2415ad097c446cc1fdb6cbba49fd9c8101
branch: master
repository: swarm-arena
topic: "/10x-ui audit of src/app/dashboard/page.tsx (S-46, M-12 UI modernization pass)"
tags: [research, codebase, dashboard, ui, design-system, tabs, status-message]
status: complete
last_updated: 2026-11-20
last_updated_by: Claude Sonnet 5
---

# Research: /10x-ui audit of the dashboard view

**Date**: 2026-11-20T04:20:22+01:00
**Researcher**: Claude Sonnet 5
**Git Commit**: 6b175a2415ad097c446cc1fdb6cbba49fd9c8101
**Branch**: master
**Repository**: swarm-arena

## Research Question

`/10x-ui`'s pre-audit on `src/app/dashboard/page.tsx` (239 lines) raised 4 candidate charges (missing-shared-component for the status filter, missing-shared-component for the duplicated Running/Saved/Completed sections, a possible `StatusMessage` extension for the error/empty states, and a lower-priority local-duplication note). This research confirms or rejects each charge against actual component APIs and other callers, so `/10x-plan` can turn confirmed charges into phases without rediscovery.

## Summary

Of the 4 candidate charges, **2 are confirmed and INCLUDE**, **1 is confirmed and INCLUDE with a narrower scope than proposed**, and **1 is DEFER** (folded into the narrowed charge):

1. **INCLUDE** — the status filter (lines 73-88) should use the repo's own `Tabs`/`TabsList`/`TabsTrigger` component (`src/components/ui/tabs.tsx`) instead of a hand-rolled `Button` loop. Confirmed drop-in compatible with the existing controlled `useState<StatusFilter>` model (`src/components/ui/tabs.tsx:8-22` wraps Radix `Tabs.Root`, which supports controlled `value`/`onValueChange` natively — the one existing usage in this repo, `src/app/simulation/page.tsx:1026`, happens to use uncontrolled `defaultValue` instead, but that is a caller choice, not an API constraint).
2. **INCLUDE** — a shared `RunRow` component for the Running/Saved/Completed sections (lines 111-227). Confirmed each row differs only by composable, prop-shaped slots (a leading checkbox for Completed only, a trailing score/auto-stopped note for Completed only, and an action href/label) — not by deep conditional logic — so extraction is clean, not an awkward conditional pile. **Scope found wider than the original charge**: `src/app/leaderboard/page.tsx:53,59-60` contains a near-identical row (`bg-background flex items-center justify-between gap-2 rounded-full px-4 py-2`, the exact same `Run #{id} — {boidCount} boids, {predatorCount} predators — started {date}` text). A shared `RunRow` would benefit at least 2 views. This change stays scoped to dashboard only (per `/10x-ui`'s "one view plus global tokens per change" rule), but the component should be placed and named so leaderboard's own `/10x-ui` pass (S-47, already queued next in M-12) can adopt it without a second extraction.
3. **DEFER — do not extend `StatusMessage`.** Confirmed both existing callers (`src/app/runs/[runId]/page.tsx:69,74` and `src/app/runs/compare/page.tsx:105,109,113`) use `StatusMessage` as a full-page **early-return replacement** — nothing else renders alongside it. Dashboard's need is structurally different: the header and status-filter tabs must stay visible above the error/empty message (it's an inline slot within an always-rendered page, never an early return). Forcing `StatusMessage` to support both shapes would serve zero other current callers and risks the full-page callers accidentally losing their takeover styling. No precedent for the "inline, not full-page" variant exists anywhere else in the app.
4. **Folds into #3's resolution, scope narrowed to local-only**: the error block (lines 95-98) and empty block (lines 99-108) duplicate each other's container classes (`bg-input text-foreground ... rounded-2xl px-6 py-8 text-center`) within this one file. Since #3 rejects a shared-component fix, the remaining fix is local: collapse the two into one local constant/wrapper inside `page.tsx` itself. Low impact, no cross-file change.

## Detailed Findings

### Charge 1 — Status filter should use `Tabs`

- `src/app/dashboard/page.tsx:73-88` renders `STATUS_FILTERS.map(...)` as a loop of plain `Button` elements, branching `className` by `f.value === filter` to fake an active/inactive visual state. No `role="tablist"`/`role="tab"` semantics, no arrow-key navigation between options — both of which Radix's `Tabs.Root`/`Tabs.Trigger` provide automatically.
- `src/components/ui/tabs.tsx:8-22` (`Tabs`) is a thin wrapper around `TabsPrimitive.Root` (Radix `Tabs`) with no custom prop restrictions — `React.ComponentProps<typeof TabsPrimitive.Root>` is spread through, so `value`/`onValueChange` (controlled mode) work exactly as Radix documents them.
- `src/components/ui/tabs.tsx:56-71` (`TabsTrigger`) already carries a `focus-visible` ring (`focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:outline-ring`), so adopting it is also a free win for this view's keyboard-focus state (currently relies only on `Button`'s own default focus ring, same token family, so no visual regression — just the correct semantic element).
- `src/app/simulation/page.tsx:1026-1034,1089-1097` is the only existing `Tabs` usage in the app — it pairs `TabsList`/`TabsTrigger` with `TabsContent` (content-switching), using uncontrolled `defaultValue="0"`. Dashboard's filter is structurally different (filters which of 3 always-mounted sections render below, not a single active content panel per tab) — so dashboard's usage should use `Tabs`/`TabsList`/`TabsTrigger` in **controlled** mode (`value={filter} onValueChange={(v) => setFilter(v as StatusFilter)}`) and skip `TabsContent` entirely, rendering the filtered sections as plain siblings below the `Tabs` element exactly as the sections render today.

### Charge 2 — Shared `RunRow` component

- `src/app/dashboard/page.tsx:111-227` — three `<section>` blocks (Running, Saved, Completed), each mapping over its own query's data to a `<div className="bg-background flex items-center justify-between gap-2 rounded-full px-4 py-2">` row. Running (114-130) and Saved (137-153) are **structurally identical** except for the data source and the `Link` destination (`/simulation` for both, actually — confirmed both go to `/simulation`, not divergent). Completed (162-204) adds: a leading `Checkbox` (170-175), a trailing score span (182-186) and a conditional "Stopped automatically" note (190-194), and its action `Link` goes to `/runs/${run.id}` with label "View analysis" instead of `/simulation` with label "View".
- No conditional logic depends on run status beyond what's already composable as props/children — a `RunRow` taking `{ leading?: ReactNode; label: ReactNode; trailing?: ReactNode; actionHref: string; actionLabel: string }` (or equivalent named slots) covers all three call sites without branching inside the shared component itself. This is the "compose via props" shape `/10x-ui` asks for, not the "awkward conditional pile" shape that would argue against extraction.
- `src/app/leaderboard/page.tsx:53,59-60` — the leaderboard's own completed-run row uses the exact same container class string and the exact same `Run #{id} — {boidCount} boids, {predatorCount} predators — started {date}` text pattern. This was not part of the original audit brief's scope (dashboard-only) but is material: a `RunRow` extracted now, if placed under `src/components/` (not inlined in `src/app/dashboard/`), directly unblocks a cleaner S-47 (leaderboard's own queued `/10x-ui` pass in this same milestone) instead of that change re-discovering and re-extracting the same component.

### Charge 3 — `StatusMessage` is the wrong fix for the error/empty states

- `src/components/ui/status-message.tsx:1-6` — `StatusMessage` renders `<div className="from-primary to-background text-foreground flex min-h-screen flex-col items-center justify-center bg-gradient-to-b p-8"><p>{children}</p></div>` — a full-viewport takeover with its own gradient background, matching the page-root pattern (`AGENTS.md`'s own documented early-return-loading/error/empty convention), not an inline card.
- `src/app/runs/[runId]/page.tsx:68-76` and `src/app/runs/compare/page.tsx:104-114` both use it only as an **early return** — the function returns `<StatusMessage>...</StatusMessage>` directly, nothing else in the component renders alongside it.
- Dashboard's error (`page.tsx:95-98`) and empty (`page.tsx:99-108`) states render **inside** the same return, as a sibling of the already-rendered `<h1>` and the `STATUS_FILTERS` tab row above them (lines 69-88 render unconditionally before the `isLoading ? ... : isError ? ... : isEmpty ? ... : (...)` ternary at line 90). Swapping in `StatusMessage` here would either (a) require `StatusMessage` to grow a "non-full-page" variant serving zero other current callers, or (b) visually break dashboard by taking over the full viewport including the header/tabs the user should still see. Neither is justified by one caller. Verdict confirmed: DEFER the shared-component route.

## Code References

- `src/app/dashboard/page.tsx:73-88` — hand-rolled status filter (Charge 1 target).
- `src/app/dashboard/page.tsx:95-108` — error/empty state blocks (Charge 3/4 target).
- `src/app/dashboard/page.tsx:111-227` — Running/Saved/Completed sections (Charge 2 target).
- `src/components/ui/tabs.tsx:1-71` — `Tabs`/`TabsList`/`TabsTrigger`/`TabsContent`, confirmed controlled-mode-compatible.
- `src/app/simulation/page.tsx:1026-1034,1089-1097` — the app's one existing `Tabs` usage (uncontrolled, content-switching shape — informative precedent, not a template to copy verbatim).
- `src/components/ui/status-message.tsx:1-6` — `StatusMessage`, confirmed full-page-only shape.
- `src/app/runs/[runId]/page.tsx:69,74` and `src/app/runs/compare/page.tsx:105,109,113` — `StatusMessage`'s only 2 existing callers, both early-return.
- `src/app/leaderboard/page.tsx:53,59-60` — the cross-view precedent strengthening Charge 2's scope.

## Architecture Insights

- This repo's design-token contract (per `AGENTS.md`) is already fully respected in `dashboard/page.tsx` — zero literal colors, zero Tailwind palette classes, zero arbitrary values found by the hardcoded-value scan. The drift here is entirely in the second half of the design-system contract — **shared components** — not token usage. This matches `/10x-ui`'s own framing that a view can be "technically correct" on tokens while still missing shared components.
- `AGENTS.md`'s existing rule ("A hand-copied `<label>`+`<Input>` block repeated across many fields is a missing-shared-component signal... The same applies to a repeated loading/error/empty-message shell — see `src/components/ui/status-message.tsx`") already anticipated exactly this class of drift — but `StatusMessage` itself was designed for one shape (full-page early return) that doesn't cover every repeated-shell case. The rule's intent (don't hand-copy a shell) still applies; the fix for dashboard's inline case is a new, smaller local pattern, not forcing the existing component to do double duty.

## Historical Context (from prior changes)

- `context/archive/2026-11-14-dashboard-restyle/plan.md` — M-3's original restyle (S-16) established the current token usage and the `Button`-based filter/row patterns being audited here; no shared `RunRow`/`Tabs`-filter pattern existed yet at that time (`Tabs` itself wasn't added to the repo until a later milestone).

## Related Research

- None — this is the first `/10x-ui` pass run against this repo under M-12.

## Open Questions

- None blocking. The leaderboard cross-view finding (Charge 2) is informative for `/10x-plan` on *where* to place `RunRow` (e.g. `src/components/run-row.tsx` rather than inlined in `dashboard/`), not a blocking unknown — this change still only edits `dashboard/page.tsx` and the new shared component; leaderboard's own adoption is S-47's job, not this change's.

## Charges

| # | Category | Verdict | File:line | User impact |
|---|----------|---------|-----------|--------------|
| 1 | Missing shared component | **INCLUDE** | `src/app/dashboard/page.tsx:73-88` | No tab semantics/keyboard arrow-key navigation on the status filter today; adopting `Tabs` fixes both for free. |
| 2 | Missing shared component | **INCLUDE** (scope: extract `RunRow` as a reusable component, not inlined — benefits S-47/leaderboard too, though this change edits dashboard only) | `src/app/dashboard/page.tsx:111-227` | No direct user-visible bug today; prevents 3x-duplicated hand-edits drifting apart on the next per-row change. |
| 3 | Missing shared component (proposed) → Accidental-architecture risk if forced | **DEFER** — do not extend `StatusMessage`; it is a full-page-only component with 2 existing callers, neither of which needs an inline variant. | `src/app/dashboard/page.tsx:95-108`, `src/components/ui/status-message.tsx:1-6` | None — rejecting this avoids forcing an ill-fitting shared component. |
| 4 | Local duplication (minor) | **INCLUDE**, narrowed to a local-only fix (no new shared component; collapse the two blocks into one local constant inside `page.tsx`) | `src/app/dashboard/page.tsx:95-108` | None directly visible; pure maintainability. |
