# Dashboard view modernization pass Implementation Plan

## Overview

Re-audit the post-login dashboard (`src/app/dashboard/page.tsx`) against this repo's design-system contract via `/10x-ui`. The pre-audit found zero token drift (colors/spacing already use semantic tokens correctly) but real missing-shared-component drift accumulated across 6 feature commits since M-3's original restyle: a hand-rolled tab-like status filter where the repo's own `Tabs` component applies, and ~90%-duplicated Running/Saved/Completed row markup where a shared `RunRow` component applies.

## Current State Analysis

- `src/app/dashboard/page.tsx:73-88` renders the "All/Running/Saved/Completed" status filter as a loop of plain `Button` elements with hand-rolled active/inactive `className` branching — no tab semantics, no keyboard arrow-key navigation.
- `src/components/ui/tabs.tsx:8-71` already exists and wraps Radix `Tabs.Root`/`List`/`Trigger`/`Content`, confirmed controlled-mode-compatible (`value`/`onValueChange` pass straight through `React.ComponentProps<typeof TabsPrimitive.Root>`). `src/app/simulation/page.tsx:1026-1034,1089-1097` is the one existing usage in this repo (uncontrolled `defaultValue`, paired with `TabsContent` for content-switching — a different shape than dashboard's filter-only need).
- `src/app/dashboard/page.tsx:111-227` has three structurally near-identical `<section>` blocks (Running, Saved, Completed), each rendering a `<div className="bg-background flex items-center justify-between gap-2 rounded-full px-4 py-2">` row. Completed's row additionally has a leading `Checkbox`, a trailing score/auto-stopped note, and a different action `Link` (`/runs/${id}` + "View analysis" vs `/simulation` + "View"). No shared component exists; `src/app/leaderboard/page.tsx:53,59-60` has the same row shape, confirming cross-view value in placing the new component under `src/components/` rather than inlining it in `dashboard/`.
- `src/app/dashboard/page.tsx:95-108` has two hand-rolled blocks (error, empty) sharing identical container markup. `src/components/ui/status-message.tsx` exists but is confirmed (research) to be a full-page early-return-only component with 2 existing callers (`runs/[runId]/page.tsx`, `runs/compare/page.tsx`), neither of which needs an inline variant — extending it would serve zero other callers and risks breaking their full-page takeover shape. Fix stays local to `dashboard/page.tsx`.
- Full detail and oracle citations: `context/changes/dashboard-ui-refresh/research.md`.

## Desired End State

The dashboard's status filter uses the repo's real `Tabs` component (keyboard-navigable, correct ARIA roles). Running/Saved/Completed rows render through one shared `RunRow` component (placed so leaderboard's own future `/10x-ui` pass can adopt it without re-extracting). The error/empty blocks no longer duplicate their container markup. A kitchen-sink page proves all 7 states side by side. The agent rules file keeps the next agent on these same components.

### Key Discoveries:

- `Tabs`'s controlled mode is a documented Radix capability this repo's one existing caller simply hasn't exercised yet — adopting it is not a new pattern, just a new combination of an existing one.
- `RunRow`'s three call sites differ only by composable props/slots (leading element, trailing element, action href/label) — confirmed non-conditional, so extraction is clean (research explicitly checked this to rule out "awkward conditional pile" as a reason not to extract).
- `StatusMessage` is the wrong fix for dashboard's inline error/empty states — both its real callers are full-page early returns; forcing a second shape onto it would be solving a one-caller problem with a shared-component change (research's own stated reason to DEFER that route).

## What We're NOT Doing

- Not touching `leaderboard/page.tsx` even though it shares `RunRow`'s row shape — that's S-47's own `/10x-ui` pass (already queued next in M-12), per the "one view plus global tokens per change" rule. `RunRow` is placed reusably so S-47 can import it, not so this change edits leaderboard.
- Not extending `StatusMessage` — rejected by research (see Current State Analysis).
- Not changing dashboard's data-fetching (`listRunning`/`listSaved`/`listCompleted` polling), the compare-selection logic (`selectedIds`, `canCompare`), or any business logic — this is a presentation-layer-only change.
- Not adding a screenshot-testing tool — this repo has none installed (confirmed by the existing `src/app/simulation/kitchen-sink/page.tsx` precedent, which uses manual kitchen-sink review as its own stated gate, not `toHaveScreenshot`). This change follows the same precedent.
- Not touching the Running/Saved section's own `Link` destination (`/simulation` for both) — `RunRow`'s props carry whatever each call site already passes; no behavior change.

## Implementation Approach

Two phases, in dependency order: the component refactor first (extract `RunRow`, adopt `Tabs`, collapse local duplication), then the states gate and guard (kitchen-sink page, re-run the hardcoded-value scan, update the agent rules file) — matching `/10x-ui`'s router order with the empty environment/token-value phases skipped (nothing needed there: the `Tabs` component already exists, and token usage was already correct).

## Phase 1: Dashboard component refactor

### Overview

Extract a reusable `RunRow` component, replace the hand-rolled status filter with the repo's `Tabs` component in controlled mode, and collapse the duplicated error/empty container markup into one local helper.

### Changes Required:

#### 1. `RunRow` shared component

**File**: `src/components/run-row.tsx` (new)

**Intent**: Give the three near-identical run-list rows (Running, Saved, Completed) one implementation instead of three hand-copied ones, placed under `src/components/` (not inlined in `dashboard/`) so leaderboard's own queued `/10x-ui` pass can import it later without re-extracting.

**Contract**: `RunRow({ leading, label, trailing, actionHref, actionLabel }: { leading?: React.ReactNode; label: React.ReactNode; trailing?: React.ReactNode; actionHref: string; actionLabel: string })` rendering the existing `<div className="bg-background flex items-center justify-between gap-2 rounded-full px-4 py-2">` row shape with `leading` (optional, e.g. the Completed section's `Checkbox`) before `label`, `trailing` (optional, e.g. the score/auto-stopped note) after it, and a `Button asChild` wrapping a `Link` to `actionHref` with `actionLabel` as its text — copied verbatim from the existing row markup, no visual change.

#### 2. Status filter → `Tabs`

**File**: `src/app/dashboard/page.tsx`

**Intent**: Replace the hand-rolled `Button` loop (lines 73-88) with the repo's real `Tabs` component in controlled mode, gaining correct tab semantics and keyboard arrow-key navigation with no visual change to the existing active/inactive styling.

**Contract**: `<Tabs value={filter} onValueChange={(v) => setFilter(v as StatusFilter)}>` wraps a `<TabsList>` containing one `<TabsTrigger value={f.value}>{f.label}</TabsTrigger>` per `STATUS_FILTERS` entry. No `TabsContent` is used — the filtered sections below render as plain siblings exactly as they do today (dashboard's filter changes which sections render, not which single content panel shows). Existing active/inactive visual styling (`bg-foreground/35` vs `bg-input`) is preserved via `TabsTrigger`'s own `data-active` styling already defined in `src/components/ui/tabs.tsx` — this phase does not invent new classNames, it lets `TabsTrigger`'s existing token-driven active state take over from the manual ternary.

#### 3. Running/Saved/Completed sections → `RunRow`

**File**: `src/app/dashboard/page.tsx`

**Intent**: Replace each section's hand-rolled row markup (lines 114-130, 137-153, 162-204) with `RunRow`, passing each section's existing data straight through as props — no new state, no behavior change.

**Contract**: Running/Saved sections: `<RunRow label={...} actionHref="/simulation" actionLabel="View" />` per item (no `leading`/`trailing`). Completed section: `<RunRow leading={<Checkbox ... />} label={...} trailing={<score/auto-stopped markup>} actionHref={`/runs/${run.id}`} actionLabel="View analysis" />` per item, preserving the existing `selectionDisabled`/`isSelected`/score-formatting/`wasAutoStopped` logic unchanged — only the markup moves into `RunRow`'s slots.

#### 4. Error/empty duplication → local helper

**File**: `src/app/dashboard/page.tsx`

**Intent**: Collapse the two hand-rolled container blocks (lines 95-98, 99-108) sharing identical `className` into one local constant or small wrapper, removing the duplicated class string without changing either block's rendered content.

**Contract**: A local `const statusCardClassName = "bg-input text-foreground flex w-full max-w-md flex-col items-center gap-3 rounded-2xl px-6 py-8 text-center"` (or equivalent) referenced by both the error and empty branches — no new exported component, no new file; scoped to this one file since research confirmed no cross-view reuse case exists.

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `npm run typecheck`
- Lint passes: `npm run check`
- Full suite still passes: `npm test`
- Hardcoded-value scan on the touched files stays at 0 hits: `grep -nE '#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|oklch\(|-\[[0-9.]+(px|rem)\]|\b(bg|text|border|ring|outline|from|via|to|fill|stroke|shadow|divide)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black)\b' src/app/dashboard/page.tsx src/components/run-row.tsx`

#### Manual Verification:

- Dashboard's status filter (All/Running/Saved/Completed) looks visually unchanged and still filters sections correctly, now also navigable via arrow keys between tabs.
- Running, Saved, and Completed rows render identically to before (including the Completed section's checkbox, score, auto-stopped note, and both button variants for "Compare selected").
- Error state (simulate via devtools network block or a failing query) and empty state (no runs) render with no visual change from before.

## Phase 2: States gate & guard

### Overview

Prove the 7-state matrix via a kitchen-sink page (this repo's established pattern, see `src/app/simulation/kitchen-sink/page.tsx`), confirm the hardcoded-value scan stays clean, and extend the agent rules file so the next agent keeps using `RunRow`/`Tabs` instead of re-inventing them.

### Changes Required:

#### 1. Dashboard kitchen-sink page

**File**: `src/app/dashboard/kitchen-sink/page.tsx` (new)

**Intent**: Render `RunRow` and the `Tabs`-based filter in all 7 `/10x-ui` states side by side (default, hover, focus-visible, disabled, error, empty, loading) for review and future screenshotting, following the same structure and comment style as `src/app/simulation/kitchen-sink/page.tsx`. This page's own root element is a `<div>` (not `<main>`), per this repo's landmark rule (`AGENTS.md`) — the existing simulation kitchen-sink page predates that rule and is out of this change's scope to fix.

**Contract**: One `<section>` per state: `default`/`hover` (a `RunRow` with its real classes — hover noted as pointer-driven, can't be forced in a static render, same caveat style as the existing kitchen-sink's Button section), `focus-visible` (a `TabsTrigger` with a code comment on how to trigger it via Tab key during review), `disabled` (the existing "Compare selected" disabled `Button` variant, already in `dashboard/page.tsx:218-224`), `error`/`empty` (the two collapsed-helper blocks from Phase 1.4), `loading` (the existing `Skeleton` blocks from `dashboard/page.tsx:91-94`).

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `npm run typecheck`
- Lint passes: `npm run check`
- Full suite still passes: `npm test`

#### Manual Verification:

- Visit `/dashboard/kitchen-sink` and confirm all 7 states are visible (or, for `hover`, triggerable by moving the pointer) — screenshot at desktop and one mobile width.
- `focus-visible` shows a visible ring on keyboard Tab into a `TabsTrigger`, using the `--ring` token (not a browser default outline).
- `AGENTS.md`'s UI section gained a short note pointing at `RunRow` (`src/components/run-row.tsx`) and the dashboard's `Tabs` usage as the pattern to check before hand-rolling a run-list row or a filter control — placed outside any `<!-- BEGIN @przeprogramowani/10x-cli -->` … `<!-- END … -->` block if one exists in that file.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to archive.

---

## Testing Strategy

### Unit Tests:

- None new — this repo has no existing unit tests for dashboard or any `src/components/ui`-level presentation component (confirmed: `find src/app/dashboard src/components -iname "*.test.*"` returns nothing), consistent with this repo's convention of unit-testing server/engine logic, not presentation markup. `RunRow` is a thin, prop-driven presentational wrapper with no logic of its own to unit test.

### Manual Testing Steps:

1. Phase 1's manual checks (filter behavior, row rendering, error/empty states).
2. Phase 2's manual checks (7-state kitchen sink, focus-visible ring, agent-rule addition).

## Performance Considerations

None — this is a presentation-layer refactor with no new data fetching, no new client-side computation, and no change to polling cadence.

## Migration Notes

None — no persisted data shape changes.

## References

- `context/changes/dashboard-ui-refresh/research.md` — `/10x-ui` audit findings and charge verdicts.
- `src/components/ui/tabs.tsx` — `Tabs`/`TabsList`/`TabsTrigger`/`TabsContent`.
- `src/app/simulation/page.tsx:1026-1034` — the app's one existing `Tabs` usage (uncontrolled, informative precedent).
- `src/components/ui/status-message.tsx` — confirmed full-page-only; not extended by this plan.
- `src/app/simulation/kitchen-sink/page.tsx` — kitchen-sink precedent this plan's Phase 2 follows.
- `src/app/leaderboard/page.tsx:53,59-60` — cross-view precedent motivating `RunRow`'s placement under `src/components/`.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Dashboard component refactor

#### Automated

- [x] 1.1 Typecheck passes: `npm run typecheck` — cce2837
- [x] 1.2 Lint passes: `npm run check` — cce2837
- [x] 1.3 Full suite still passes: `npm test` — cce2837
- [x] 1.4 Hardcoded-value scan on touched files stays at 0 hits — cce2837

#### Manual

- [x] 1.5 Status filter looks unchanged and filters correctly, now arrow-key navigable — verified live (production build): clicking a tab filters to that section, `ArrowRight` moves selection/focus between tabs (real `role="tablist"`/`role="tab"` semantics via Radix, confirmed in the accessibility snapshot), each tab's `data-active` styling matches the old `bg-foreground/35`/`bg-input` look. — cce2837
- [x] 1.6 Running/Saved/Completed rows render identically to before — verified live with 4 seeded rows (1 running, 1 saved, 2 completed: one scored, one null-score+auto-stopped): all labels, the checkbox, the score/auto-stopped text, and both action links (`/simulation` "View", `/runs/<id>` "View analysis") render exactly as before. Checking 2 completed rows correctly enabled "Compare selected" linking to `/runs/compare?ids=<id>,<id>`. — cce2837
- [x] 1.7 Error and empty states render with no visual change — verified live: with 0 runs, the empty-state card ("You haven't started any simulations yet." + "Start a simulation" link) renders via the collapsed `statusCardClassName` helper with the same container styling as before. — cce2837

### Phase 2: States gate & guard

#### Automated

- [ ] 2.1 Typecheck passes: `npm run typecheck`
- [ ] 2.2 Lint passes: `npm run check`
- [ ] 2.3 Full suite still passes: `npm test`

#### Manual

- [ ] 2.4 All 7 states visible/triggerable at `/dashboard/kitchen-sink`, screenshot at desktop and one mobile width
- [ ] 2.5 Focus-visible ring uses the `--ring` token, not a browser default
- [ ] 2.6 `AGENTS.md` UI section gained the `RunRow`/`Tabs` guard note
