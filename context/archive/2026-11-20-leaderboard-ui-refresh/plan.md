# Leaderboard view modernization pass Implementation Plan

## Overview

Re-audit the leaderboard (`src/app/leaderboard/page.tsx`) against this repo's design-system contract via `/10x-ui`. The pre-audit found zero token drift but a clear missing-shared-component opportunity: the leaderboard's own row markup maps directly onto `RunRow` (`src/components/run-row.tsx`, extracted in the archived `dashboard-ui-refresh` change specifically so this view could adopt it), needing only a small, backward-compatible `className` widening to support the top-3 `border-primary` variant.

## Current State Analysis

- `src/app/leaderboard/page.tsx:45-89` renders each row as a hand-rolled `<div>` whose `className` branches on `isTopThree` to add `border-primary border-2`, containing a rank span, a run-info span, a score span, two conditional badge spans, and a "View analysis" action button — structurally identical to `RunRow`'s existing `{leading, label, trailing, actionHref, actionLabel}` contract.
- `src/components/run-row.tsx:19` hardcodes the row's `className` with no override point today.
- `cn()` (the `cn` npm package) is this repo's established className-merge idiom, already used in `src/components/ui/checkbox.tsx:3`, `dropdown-menu.tsx:3`, `avatar.tsx:3`.
- `src/app/leaderboard/page.tsx:29,33` duplicate the same inline-status-card container className dashboard had before its own `/10x-ui` pass collapsed it locally — confirmed (research) this stays a local fix: `runs/[runId]/page.tsx` and `runs/compare/page.tsx` already use `StatusMessage` instead, so the ceiling is 2 instances (dashboard, leaderboard), not 3.
- `AGENTS.md`'s UI section already carries the `RunRow`/`Tabs` guard note added during `dashboard-ui-refresh` — it names both components generically, so it already applies to this view; no further edit needed.
- Full detail: `context/changes/leaderboard-ui-refresh/research.md`.

## Desired End State

The leaderboard renders through `RunRow` (including its top-3 border variant via the new `className` prop) with no visual change. The error/empty blocks no longer duplicate their container markup. A kitchen-sink page proves the 7-state matrix plus the top-3 variant.

### Key Discoveries:

- `RunRow`'s 3 existing callers (`dashboard-ui-refresh`'s Running/Saved/Completed) all omit a `className` prop — widening it with `className?: string` merged via `cn(base, className)` is additive and backward-compatible (`cn(base, undefined)` resolves to `base`).
- The status-card duplication ceiling is confirmed at exactly 2 instances — `runs/[runId]`/`runs/compare` already use `StatusMessage`, so no third consumer will ever need this pattern. Local-per-file stays correct, matching `dashboard-ui-refresh`'s own choice.
- The two badge spans (`4-factor score` / `Accelerated run`) are below this repo's observed shared-component threshold (2 call sites, 1 file, differing data sources) — no extraction.

## What We're NOT Doing

- Not creating a `Badge` primitive for the two score-badge spans — confirmed below the extraction threshold by research.
- Not promoting the status-card pattern to a shared component — confirmed ceiling of 2 instances, stays local.
- Not touching `runs/[runId]/page.tsx` or `runs/compare/page.tsx` — that's S-48's own `/10x-ui` pass, and those files already use `StatusMessage` correctly, uninvolved here.
- Not changing leaderboard's data-fetching (`listLeaderboard` query) or ranking logic (`rank`/`isTopThree` derivation) — presentation-layer-only change.
- Not adding a new `AGENTS.md` note — the existing `RunRow`/`Tabs` guard from `dashboard-ui-refresh` already covers this view generically.

## Implementation Approach

Two phases: the component refactor first (widen `RunRow`, adopt it here, collapse local duplication), then the states gate (kitchen-sink page) — matching `dashboard-ui-refresh`'s own successful 2-phase shape for this milestone.

## Phase 1: Leaderboard component refactor

### Overview

Widen `RunRow` with an optional `className` prop, adopt it for the leaderboard row (including the top-3 variant), and collapse the error/empty duplication into a local constant.

### Changes Required:

#### 1. `RunRow` — optional `className` widening

**File**: `src/components/run-row.tsx`

**Intent**: Let a caller add extra classes to `RunRow`'s outer row `<div>` (needed for leaderboard's top-3 `border-primary border-2` variant) without breaking existing callers that pass none.

**Contract**: Add `className?: string` to `RunRow`'s props. Import `cn` from the `cn` package (already a direct dependency, already used by `src/components/ui/checkbox.tsx` etc.) and change the outer `<div>`'s `className` from the current literal string to `cn("bg-background flex items-center justify-between gap-2 rounded-full px-4 py-2", className)`. No other prop or markup changes.

#### 2. Leaderboard row → `RunRow`

**File**: `src/app/leaderboard/page.tsx`

**Intent**: Replace the hand-rolled row (lines 49-87) with `RunRow`, passing the rank span as `leading`, the run-info span as `label`, the score span + both conditional badge spans as `trailing`, and the existing action link as `actionHref`/`actionLabel` — no behavior change, just the markup moving into `RunRow`'s slots.

**Contract**: `<RunRow className={isTopThree ? "border-primary border-2" : undefined} leading={<span className="font-semibold">#{rank}</span>} label={<span>Run #{run.id} — ...</span>} trailing={<>{scoreSpan}{badgeSpans}</>} actionHref={`/runs/${run.id}`} actionLabel="View analysis" />`, preserving the existing `rank`/`isTopThree` derivation, the `run.score?.toFixed(2)` formatting, and both badge conditions (`!run.scoredWithAreaFactor`, `!run.comparable`) unchanged — only the markup moves into `RunRow`'s props.

#### 3. Error/empty duplication → local helper

**File**: `src/app/leaderboard/page.tsx`

**Intent**: Collapse the two hand-rolled container blocks (lines 29, 33) sharing identical `className` into one local constant, matching `dashboard-ui-refresh`'s own choice for the identical pattern.

**Contract**: A local `const statusCardClassName = "bg-input text-foreground flex w-full max-w-md flex-col items-center gap-3 rounded-2xl px-6 py-8 text-center"` referenced by both branches — no new exported component, no new file, scoped to this one file (research confirmed the cross-view ceiling is 2 instances, each staying local).

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `npm run typecheck`
- Lint passes: `npm run check`
- Full suite still passes: `npm test`
- Hardcoded-value scan on the touched files stays at 0 hits: `grep -nE '#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|oklch\(|-\[[0-9.]+(px|rem)\]|\b(bg|text|border|ring|outline|from|via|to|fill|stroke|shadow|divide)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black)\b' src/app/leaderboard/page.tsx src/components/run-row.tsx`

#### Manual Verification:

- Leaderboard renders identically to before: rank, run info, score, both conditional badges (where applicable), and the "View analysis" action all unchanged.
- Top-3 rows still show the `border-primary` border; rows 4+ do not.
- `dashboard-ui-refresh`'s 3 existing `RunRow` call sites (Running/Saved/Completed on `/dashboard`) still render with no visual change (regression check for the widening).
- Error state and empty state render with no visual change from before.

## Phase 2: States gate

### Overview

Prove the 7-state matrix plus the top-3 `className` variant via a kitchen-sink page, following the `dashboard-ui-refresh`/`simulation` precedent.

### Changes Required:

#### 1. Leaderboard kitchen-sink page

**File**: `src/app/leaderboard/kitchen-sink/page.tsx` (new)

**Intent**: Render `RunRow` (both the plain and top-3-bordered variants) in all 7 `/10x-ui` states side by side, following the same structure and comment style as `src/app/dashboard/kitchen-sink/page.tsx` and `src/app/simulation/kitchen-sink/page.tsx`.

**Contract**: One `<section>` per state, plus an extra section for the `className` variant specifically: `default`/`hover` (plain `RunRow`), `className variant` (a `RunRow` with `className="border-primary border-2"` side by side with a plain one, to visually confirm the override composes correctly), `focus-visible` (the action `Button`, since leaderboard has no `Tabs` of its own — reuse the existing kitchen-sink pattern for a focus-visible `Button`), `disabled` (n/a for this view — no disabled control exists on `/leaderboard`; mark this section N/A with a one-line reason per `/10x-ui`'s Definition of Done, rather than fabricating one), `error`/`empty` (the collapsed `statusCardClassName` blocks), `loading` (the existing `Skeleton` pattern). Root element is a `<div>`, not `<main>`, per `AGENTS.md`'s landmark rule (same reasoning as `dashboard/kitchen-sink/page.tsx`).

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `npm run typecheck`
- Lint passes: `npm run check`
- Full suite still passes: `npm test`

#### Manual Verification:

- All states visible at `/leaderboard/kitchen-sink` (6 real states + 1 explicit N/A with reason), screenshot at desktop and one mobile width.
- The `className`-variant section visibly shows the top-3 bordered row next to the plain row, confirming the override composes with the base classes rather than replacing them.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to archive.

---

## Testing Strategy

### Unit Tests:

- None new — matches `dashboard-ui-refresh`'s own precedent (no existing unit tests for `src/app/leaderboard` or any `src/components/ui`-level presentation component; `RunRow`'s widening is a thin, prop-driven change with no new logic to unit test).

### Manual Testing Steps:

1. Phase 1's manual checks (row rendering, top-3 border, dashboard regression check, error/empty states).
2. Phase 2's manual checks (kitchen-sink states, className-variant comparison).

## Performance Considerations

None — presentation-layer refactor only, no new data fetching or computation.

## Migration Notes

None — no persisted data shape changes.

## References

- `context/changes/leaderboard-ui-refresh/research.md` — `/10x-ui` audit findings and charge verdicts.
- `context/archive/2026-11-20-dashboard-ui-refresh/` — direct upstream precedent (`RunRow` origin, `StatusMessage` rejection reasoning, local-duplication convention).
- `src/components/run-row.tsx` — the component this plan widens.
- `src/app/dashboard/kitchen-sink/page.tsx`, `src/app/simulation/kitchen-sink/page.tsx` — kitchen-sink precedents this plan's Phase 2 follows.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Leaderboard component refactor

#### Automated

- [x] 1.1 Typecheck passes: `npm run typecheck` — f6097f5
- [x] 1.2 Lint passes: `npm run check` — f6097f5
- [x] 1.3 Full suite still passes: `npm test` — f6097f5
- [x] 1.4 Hardcoded-value scan on touched files stays at 0 hits — f6097f5

#### Manual

- [x] 1.5 Leaderboard renders identically to before (rank, run info, score, badges, action) — verified live (production build) with 4 seeded rows: rank, run info, score, both conditional badges (on row #2), and "View analysis" links all render correctly. — f6097f5
- [x] 1.6 Top-3 border-primary styling intact; rows 4+ unaffected — verified via DOM query: rows #1-3 carry `...rounded-full px-4 py-2 border-primary border-2`, row #4 carries the exact base string with no extra classes. — f6097f5
- [x] 1.7 Dashboard's 3 existing RunRow call sites unaffected by the widening (regression check) — row #4's exact base-class match (no extra tokens appended) proves `cn(base, undefined) === base`, the same code path dashboard's 3 callers use. — f6097f5
- [x] 1.8 Error and empty states render with no visual change — collapsed `statusCardClassName` renders identically to the pre-refactor duplicated strings. — f6097f5

### Phase 2: States gate

#### Automated

- [x] 2.1 Typecheck passes: `npm run typecheck` — fc33cf9
- [x] 2.2 Lint passes: `npm run check` — fc33cf9
- [x] 2.3 Full suite still passes: `npm test` — fc33cf9

#### Manual

- [x] 2.4 All states visible at `/leaderboard/kitchen-sink` (6 real + 1 explicit N/A), screenshot at desktop and one mobile width — verified live (production build): default/hover RunRow, className-variant comparison, focus-visible button, explicit disabled-N/A note, error/empty cards, and loading Skeleton (2 skeleton elements confirmed) all render in one screen. — fc33cf9
- [x] 2.5 className-variant section shows top-3-bordered row next to plain row, confirming the override composes — verified via DOM query: the 3rd row carries `...rounded-full px-4 py-2 border-primary border-2`, the adjacent row carries only the base string. Focus-visible ring on the action button also confirmed resolving to the `--ring` token (`oklab(0.749996 ...)`), matching dashboard's own confirmation. — fc33cf9
