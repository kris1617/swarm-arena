---
date: 2026-11-20T04:54:11+01:00
researcher: Claude Sonnet 5
git_commit: 1b8067882ec84f797b96cce3b9934a727a4a566e
branch: master
repository: swarm-arena
topic: "/10x-ui audit of src/app/leaderboard/page.tsx (S-47, M-12 UI modernization pass)"
tags: [research, codebase, leaderboard, ui, design-system, run-row]
status: complete
last_updated: 2026-11-20
last_updated_by: Claude Sonnet 5
---

# Research: /10x-ui audit of the leaderboard view

**Date**: 2026-11-20T04:54:11+01:00
**Researcher**: Claude Sonnet 5
**Git Commit**: 1b8067882ec84f797b96cce3b9934a727a4a566e
**Branch**: master
**Repository**: swarm-arena

## Research Question

`/10x-ui`'s pre-audit on `src/app/leaderboard/page.tsx` (95 lines) raised 3 candidate charges: adopting `RunRow` (already extracted in the archived `dashboard-ui-refresh` change specifically for this reuse) with a needed `className` widening for the top-3 border variant, whether the error/empty inline-status-card duplication now justifies a shared component across 2+ views, and a lower-priority badge-span duplication. This research confirms or rejects each against actual component code and other callers.

## Summary

Of the 3 candidate charges, **1 is confirmed and INCLUDE** (RunRow adoption + a minimal, backward-compatible `className` widening), **1 is confirmed and DEFER** (the status-card duplication stays local, not promoted to a shared component), and **1 is confirmed and DEFER** (the badge spans stay as-is):

1. **INCLUDE** — adopt `RunRow` for the leaderboard row, widened with an optional `className?: string` prop merged via this repo's existing `cn()` utility (`src/components/ui/checkbox.tsx:3`, `dropdown-menu.tsx:3`, `avatar.tsx:3` all already import `cn` from the `cn` package — confirmed established idiom, not a new dependency). `RunRow`'s outer `<div>` becomes `className={cn("bg-background flex items-center justify-between gap-2 rounded-full px-4 py-2", className)}`. This is backward-compatible: `dashboard-ui-refresh`'s 3 existing call sites (`src/app/dashboard/page.tsx` Running/Saved/Completed) pass no `className` prop today, so `cn(base, undefined)` resolves to `base` unchanged — confirmed by reading `cn`'s contract (a `clsx`-family merge utility; `undefined`/`false`/`null` args are dropped). Leaderboard's top-3 rows pass `className="border-primary border-2"` to get the existing `"bg-background border-primary flex items-center justify-between gap-2 rounded-full border-2 px-4 py-2"` result unchanged in appearance.
2. **DEFER** — do not promote the error/empty inline-status-card pattern (leaderboard lines 29, 33) to a shared component. This will remain exactly 2 occurrences, not 3: `src/app/runs/[runId]/page.tsx:69,74` and `src/app/runs/compare/page.tsx` already use `StatusMessage` (the full-page early-return component, confirmed in `dashboard-ui-refresh`'s own research) for their loading/error states — grep-confirmed zero occurrences of the `bg-input text-foreground ... rounded-2xl px-6 py-8 text-center` inline-card className pattern in either file. S-48 (`run-analysis-compare-ui-refresh`) will not need this pattern at all. With the ceiling confirmed at 2 instances of ~2 lines of duplicated className, a new shared component is not justified — `dashboard-ui-refresh`'s own local-constant precedent (a non-exported `statusCardClassName` inside `page.tsx`) is the right call here too, duplicated locally in `leaderboard/page.tsx` rather than cross-file-shared.
3. **DEFER** — the two badge spans (`4-factor score` / `Accelerated run`) stay as inline conditional spans. Confirmed `src/components/ui/` has no existing `badge.tsx` (directory listing: `alert-dialog, avatar, button, checkbox, dropdown-menu, input, number-field, select, separator, sheet, sidebar, skeleton, status-message, switch, tabs, textarea, tooltip` — no badge). Two near-identical ~3-line conditional spans within one file is below this repo's established extraction threshold (compare to `RunRow`'s 3-callers-across-2-views trigger); introducing a new primitive for 2 call sites in 1 file would be premature abstraction, not a confirmed gap.

## Detailed Findings

### Charge 1 — `RunRow` adoption needs a `className` widening

- `src/app/leaderboard/page.tsx:45-89` maps the leaderboard row directly onto `RunRow`'s existing contract: `leading` = the `#{rank}` span (49-57... actually the rank span at line 57), `label` = the run-info span (58-61), `trailing` = the score span (62-64) plus the two conditional badge spans (65-80), `actionHref` = `` `/runs/${run.id}` ``, `actionLabel` = `"View analysis"`.
- The one gap: `src/app/leaderboard/page.tsx:49-54` branches the row's own `className` by `isTopThree` (adds `border-primary border-2`), while `src/components/run-row.tsx:19` hardcodes `className="bg-background flex items-center justify-between gap-2 rounded-full px-4 py-2"` with no override point today.
- `cn()` (the `cn` npm package, already a direct dependency per `package.json`) is this repo's established className-merge idiom for exactly this shape of problem — confirmed via 3 existing shadcn component files importing it the same way. Adding `className?: string` to `RunRow`'s props and wrapping the existing literal in `cn(literal, className)` is the minimal, idiomatic fix.
- Verified no breakage to existing callers: `dashboard-ui-refresh`'s archived `plan.md` confirms all 3 of `dashboard/page.tsx`'s `RunRow` calls (Running/Saved/Completed) omit a `className` prop entirely — `cn(base, undefined)` is exactly `base`.

### Charge 2 — Status-card duplication stays local (ceiling confirmed at 2)

- Grep of `src/app/runs/[runId]/page.tsx` and `src/app/runs/compare/page.tsx` for the inline-card className substring (`rounded-2xl px-6 py-8 text-center`) returns zero matches in either file — both already route their loading/error states through `StatusMessage` (confirmed call sites: `runs/[runId]/page.tsx:69,74`; `runs/compare/page.tsx` has the equivalent pattern per `dashboard-ui-refresh`'s own research, re-confirmed here).
- This directly resolves the open question from the audit brief: S-48 will not introduce a third instance of this pattern. With the ceiling at 2 (dashboard, leaderboard) and each instance being a single ~2-line className string, `dashboard-ui-refresh`'s own choice — a local, non-exported `const` inside the one file that needs it — is the consistent, proportionate answer for leaderboard too.

### Charge 3 — Badge spans stay as-is

- `src/app/leaderboard/page.tsx:65-80` — both badge spans share `bg-foreground/15 rounded-full px-2 py-0.5 text-xs font-semibold` plus a conditional-render guard and a `title` attribute, but differ in guard condition (`!run.scoredWithAreaFactor` vs `!run.comparable`), `title` source (a literal string vs `run.disclaimer`), and visible text. Two instances in one file, with meaningfully different data sources, is not the "3 near-identical call sites across 2 views" shape that justified `RunRow`'s extraction — no shared-component gap confirmed.

## Code References

- `src/app/leaderboard/page.tsx:45-89` — the row this change refactors onto `RunRow`.
- `src/app/leaderboard/page.tsx:29,33` — error/empty inline-status-card blocks (local-only fix).
- `src/components/run-row.tsx:1-34` — `RunRow`, needs the `className` widening.
- `src/components/ui/checkbox.tsx:3`, `src/components/ui/dropdown-menu.tsx:3`, `src/components/ui/avatar.tsx:3` — confirmed `cn()` idiom precedent.
- `src/app/runs/[runId]/page.tsx:69,74` — confirmed `StatusMessage` usage, ruling out a third inline-card instance.
- `context/archive/2026-11-20-dashboard-ui-refresh/research.md` — upstream research this change stays consistent with (StatusMessage rejection reasoning, `RunRow` placement rationale).

## Architecture Insights

- `RunRow`'s placement at `src/components/run-row.tsx` (not inlined under `src/app/dashboard/`) — a deliberate choice made during `dashboard-ui-refresh` specifically to enable this change — is now paying off exactly as planned: this change adopts it with a small, additive widening rather than re-extracting an equivalent component from scratch.
- The local-vs-shared threshold this repo seems to use in practice (confirmed across `RunRow` vs the status-card pattern): extract to a shared component once 3+ call sites across 2+ views exist with composable (not branching) differences; stay local below that, even at 2 occurrences.

## Historical Context (from prior changes)

- `context/archive/2026-11-20-dashboard-ui-refresh/plan.md` and `research.md` — the direct upstream precedent for this change's `RunRow` adoption, `StatusMessage` rejection, and local-duplication convention.
- `context/archive/2026-11-14-dashboard-restyle/plan.md` (referenced transitively) — M-3's original restyle established the token usage this view already respects.

## Related Research

- `context/archive/2026-11-20-dashboard-ui-refresh/research.md` — sibling `/10x-ui` audit for the same milestone, directly informs this one.

## Open Questions

- None blocking.

## Charges

| # | Category | Verdict | File:line | User impact |
|---|----------|---------|-----------|--------------|
| 1 | Missing shared component | **INCLUDE** (adopt `RunRow`, widen it with an optional `className` prop merged via `cn()`) | `src/app/leaderboard/page.tsx:45-89`, `src/components/run-row.tsx:19` | No direct user-visible bug today; removes leaderboard's own hand-copied duplicate of the row markup `RunRow` already covers, with zero visual change (verified backward-compatible for `dashboard-ui-refresh`'s 3 existing callers). |
| 2 | Local duplication (minor) | **DEFER** — stays local, not promoted to a shared component; ceiling confirmed at 2 instances (dashboard, leaderboard), since `runs/[runId]`/`runs/compare` already use `StatusMessage` instead. | `src/app/leaderboard/page.tsx:29,33` | None directly visible; pure maintainability, proportionate to 1 small local const (same choice `dashboard-ui-refresh` made). |
| 3 | Missing shared component (proposed) | **DEFER** — 2 call sites with differing data sources in 1 file does not meet this repo's observed shared-component threshold. | `src/app/leaderboard/page.tsx:65-80` | None — avoids premature abstraction for 2 call sites. |
