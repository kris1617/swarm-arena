# Restyle the run-analysis and run-comparison pages — Brief

Full plan: `context/changes/analysis-comparison-restyle/plan.md`

## What this is

Roadmap S-18 (M-3), bundling two views deliberately (per the roadmap's own S-18 Outcome). A `/10x-ui`-driven audit of `runs/[runId]/page.tsx` and `runs/compare/page.tsx` found the first *real* missing-tokens case in this round of restyles: both views hardcode chart-series colors that carry deliberate semantic meaning (green=growth, red=crash), while the repo's existing `--chart-1`..`5` tokens are unused and grayscale-only.

## Starting Point

- `PHASE_COLORS` (5 hex values) and `RUN_COLORS` (4 hex values) feed Recharts' `stroke`/`fill` props directly — literal colors, not tokens.
- `--chart-1`..`5` exist in `globals.css` but are a pure grayscale ramp, never referenced anywhere.
- Both files have multiple `<main>`-rooted early-return branches (3 in the analysis page, 4 in the comparison page) — the same sitewide landmark issue S-16/S-17 fixed, recurring more severely here.
- Two export links on the analysis page have no focus-visible treatment.
- 6 early-return branches across both files duplicate the same loading/error/empty shell.

## Key Decisions

| Decision | Choice | Why |
|---|---|---|
| Chart-color resolution | Give `--chart-1`..`5` real hue (reuse `PHASE_COLORS`' existing 5 colors), then reference the tokens from both views | User confirmed during planning — finally makes the long-unused chart tokens real and reusable for future charts (e.g. a leaderboard), rather than leaving two more local palettes to drift |
| StatusMessage location | `src/components/ui/status-message.tsx` (shared, not page-local) | Same precedent as S-17's `NumberField` — a genuinely reusable composite |
| Scope | Both views together, per the roadmap's own S-18 bundling | Roadmap decomposition already made this call; `/10x-ui`'s one-view default doesn't override an explicit roadmap decision |
| Questions asked | One (the chart-color decision) | Research resolved everything else; this was the one genuine open design choice |

## Phases

1. **Update chart tokens + build StatusMessage** — `--chart-1`..`5` get real hue; new shared component, no usage yet.
2. **Apply fixes to the analysis view** — chart-token references, 3x `<main>`→`<div>`, `StatusMessage` swap, export-link focus fix.
3. **Apply fixes to the comparison view** — chart-token references, 4x `<main>`→`<div>`, `StatusMessage` swap.
4. **States verification** — confirm all 7 states across both views, screenshot desktop + mobile.

**Prerequisites**: F-06 (done, archived). **Estimated effort**: medium — a shared token change plus edits across two files, but no new business logic.

## References

- `context/changes/analysis-comparison-restyle/research.md`
- `context/archive/2026-11-14-dashboard-restyle/`, `context/archive/2026-11-14-staging-live-view-restyle/`
- `context/foundation/lessons.md`
