# Run-analysis and run-comparison views modernization pass Implementation Plan

## Overview

Re-audit `src/app/runs/[runId]/page.tsx` and `src/app/runs/compare/page.tsx` — the highest-drift view group in M-12 — against this repo's design-system contract via `/10x-ui`. The pre-audit found zero token drift (chart colors already use `var(--chart-N)`, loading/error states already use `StatusMessage`) but a clear missing-shared-component opportunity: the same title+card shell repeats 10 times across these two files alone.

## Current State Analysis

- Both files already use `StatusMessage` correctly for loading/error early-returns (confirmed by research) — not touched.
- Both files already use `var(--chart-1)` through `var(--chart-5)` exclusively for every chart color — not touched.
- `src/app/runs/[runId]/page.tsx:138-144,147-154,156-191,193-212,214-236,238-251,253-260` — 7 instances of `<section className="bg-input text-foreground flex w-full max-w-2xl flex-col gap-2 rounded-2xl px-4 py-3">`, 6 of them immediately followed by `<h2 className="font-semibold">{title}</h2>`, one (the conditional `wasAutoStopped` notice) with no title.
- `src/app/runs/compare/page.tsx:181-197,199-243,245-263` — 3 more instances of the identical shell + title pattern.
- Full detail: `context/changes/runs-analysis-compare-ui-refresh/research.md`.

## Desired End State

Both views render identically but through a shared `AnalysisCard` component. No visual change. A kitchen-sink page proves the card's states, adapted to this view's actual surface (no filter/row interactivity like dashboard/leaderboard — the interactive elements here are the export buttons).

### Key Discoveries:

- 10 call sites within 2 files clears this repo's observed extraction threshold with room to spare — the clearest duplication case in M-12 so far.
- The same shell pattern also exists in `src/app/simulation/page.tsx` and `src/app/admin/elevation/_components/elevation-form.tsx` (grep-confirmed) — informational only; this change stays scoped to its own 2 files, per `/10x-ui`'s "one view(-group) per change" rule. A future change (e.g. S-49's admin-pages pass) can adopt the same component.
- `runs/compare/page.tsx`'s 4 notice-paragraph blocks are confirmed too dissimilar (differing text/className) to extract cleanly — deferred, stays as-is.

## What We're NOT Doing

- Not touching `StatusMessage` or either file's loading/error early-returns — already correct.
- Not touching chart colors — already compliant with the `var(--chart-N)` rule.
- Not extracting `runs/compare/page.tsx`'s 4 notice-paragraph blocks — confirmed too dissimilar for a clean extraction.
- Not touching `src/app/simulation/page.tsx` or `src/app/admin/elevation/_components/elevation-form.tsx` even though they share the same shell pattern — out of this change's scope; a future `/10x-ui` pass on those views can adopt `AnalysisCard`.
- Not changing either page's data-fetching, chart data derivation, or comparison logic — presentation-layer-only change.

## Implementation Approach

Two phases: the component refactor first (extract `AnalysisCard`, adopt it in both files), then a states gate adapted to this view's actual surface — matching the milestone's established 2-phase shape.

## Phase 1: Component refactor

### Overview

Extract a shared `AnalysisCard` component and adopt it for all 10 shell instances across both files.

### Changes Required:

#### 1. `AnalysisCard` shared component

**File**: `src/components/analysis-card.tsx` (new)

**Intent**: Give the 10 near-identical title+card sections one implementation instead of 10 hand-copied ones, placed under `src/components/` (sibling to `src/components/run-row.tsx`) so a future `/10x-ui` pass on `simulation/page.tsx` or the admin pages can adopt it without re-extracting.

**Contract**: `AnalysisCard({ title, children }: { title?: React.ReactNode; children: React.ReactNode })` rendering `<section className="bg-input text-foreground flex w-full max-w-2xl flex-col gap-2 rounded-2xl px-4 py-3">{title ? <h2 className="font-semibold">{title}</h2> : null}{children}</section>` — copied verbatim from the existing shell markup, no visual change. `title` is optional to cover the `wasAutoStopped` notice section, which has no heading.

#### 2. `runs/[runId]/page.tsx` → `AnalysisCard`

**File**: `src/app/runs/[runId]/page.tsx`

**Intent**: Replace all 7 hand-rolled sections with `AnalysisCard`, passing each section's existing title (or omitting it for the `wasAutoStopped` notice) and moving its existing content into `children` — no behavior change, just the shell markup moving into the shared component.

**Contract**: Each of the 6 titled sections becomes `<AnalysisCard title="...">{existing children unchanged}</AnalysisCard>`; the `wasAutoStopped` notice becomes `<AnalysisCard>{existing paragraph unchanged}</AnalysisCard>` (no `title` prop). All existing conditional rendering (chart-vs-fallback-text, phase tally, etc.) stays exactly as-is inside `children`.

#### 3. `runs/compare/page.tsx` → `AnalysisCard`

**File**: `src/app/runs/compare/page.tsx`

**Intent**: Replace all 3 hand-rolled sections (Parameters, Score & factors, Factor breakdown) with `AnalysisCard`, same mechanical move as above.

**Contract**: Each becomes `<AnalysisCard title="...">{existing children unchanged}</AnalysisCard>` — the table, the chart, and the parameter list all move into `children` unchanged.

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `npm run typecheck`
- Lint passes: `npm run check`
- Full suite still passes: `npm test`
- Hardcoded-value scan on touched files stays at 0 hits: `grep -nE '#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|oklch\(|-\[[0-9.]+(px|rem)\]|\b(bg|text|border|ring|outline|from|via|to|fill|stroke|shadow|divide)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black)\b' "src/app/runs/[runId]/page.tsx" src/app/runs/compare/page.tsx src/components/analysis-card.tsx`

#### Manual Verification:

- `runs/[runId]` renders identically to before: all 6 titled sections (run suggestion, population chart, diversity chart, phase tally, resilience cycles, final diversity) plus the conditional auto-stopped notice.
- `runs/compare` renders identically to before: Parameters, Score & factors table, Factor breakdown chart, plus the 4 notice-paragraph blocks (untouched).
- Both pages' export/view links and charts still work (JSON/CSV export links on `runs/[runId]`; the bar chart and comparison table on `runs/compare`).

## Phase 2: States gate

### Overview

Prove `AnalysisCard`'s states via a kitchen-sink page, adapted to this view's actual interactive surface.

### Changes Required:

#### 1. Runs-analysis kitchen-sink page

**File**: `src/app/runs/kitchen-sink/page.tsx` (new)

**Intent**: Render `AnalysisCard` in its real states for review, following the same structure/comment style as `src/app/dashboard/kitchen-sink/page.tsx` and `src/app/leaderboard/kitchen-sink/page.tsx`, adapted: this view has no filter/row interactivity, so its states are `AnalysisCard` default (with/without title), the export `Button`'s hover/focus-visible, and a representative "empty section" example (one card showing its own fallback text, e.g. "No population data recorded for this run.") rather than all 6 near-identical empty variants. `disabled` is N/A (no disabled control on either page) — mark it explicitly, not fabricated.

**Contract**: Sections: `AnalysisCard: with title` (default), `AnalysisCard: without title` (the `wasAutoStopped`-notice shape), `Button: hover`/`Button: focus-visible` (the export button, same pattern as the other kitchen-sink pages), `Button: disabled (N/A)` (explicit reason), `AnalysisCard: empty-section example` (one card rendering its fallback-text branch). Root element is a `<div>`, not `<main>`, per `AGENTS.md`'s landmark rule.

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `npm run typecheck`
- Lint passes: `npm run check`
- Full suite still passes: `npm test`

#### Manual Verification:

- All states visible at `/runs/kitchen-sink`, screenshot at desktop and one mobile width.
- Focus-visible ring on the export button uses the `--ring` token.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to archive.

---

## Testing Strategy

### Unit Tests:

- None new — matches the milestone's established precedent (no existing unit tests for any `src/app/runs` page or `src/components/ui`-level presentation component; `AnalysisCard` is a thin, prop-driven wrapper with no logic to unit test).

### Manual Testing Steps:

1. Phase 1's manual checks (both pages render identically, exports/charts still work).
2. Phase 2's manual checks (kitchen-sink states, focus-visible ring).

## Performance Considerations

None — presentation-layer refactor only.

## Migration Notes

None — no persisted data shape changes.

## References

- `context/changes/runs-analysis-compare-ui-refresh/research.md` — `/10x-ui` audit findings and charge verdicts.
- `context/archive/2026-11-20-dashboard-ui-refresh/`, `context/archive/2026-11-20-leaderboard-ui-refresh/` — direct upstream precedent (component placement convention, extraction-threshold reasoning, kitchen-sink structure).

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Component refactor

#### Automated

- [ ] 1.1 Typecheck passes: `npm run typecheck`
- [ ] 1.2 Lint passes: `npm run check`
- [ ] 1.3 Full suite still passes: `npm test`
- [ ] 1.4 Hardcoded-value scan on touched files stays at 0 hits

#### Manual

- [ ] 1.5 runs/[runId] renders identically to before (all 6 sections + conditional notice)
- [ ] 1.6 runs/compare renders identically to before (3 sections + 4 untouched notices)
- [ ] 1.7 Export links and charts still work on both pages

### Phase 2: States gate

#### Automated

- [ ] 2.1 Typecheck passes: `npm run typecheck`
- [ ] 2.2 Lint passes: `npm run check`
- [ ] 2.3 Full suite still passes: `npm test`

#### Manual

- [ ] 2.4 All states visible at `/runs/kitchen-sink`, screenshot at desktop and one mobile width
- [ ] 2.5 Focus-visible ring on the export button uses the `--ring` token
