---
topic: Run-analysis and run-comparison restyle (10x-ui audit) — design-system contract charges for src/app/runs/[runId]/page.tsx and src/app/runs/compare/page.tsx
researcher: Claude Sonnet 5
change_id: analysis-comparison-restyle
date: 2026-11-14
last_updated: 2026-11-14
last_updated_by: Claude Sonnet 5
last_updated_note: Initial research
---

# Research: Run-analysis and run-comparison restyle — design-system contract charges

## Question

Per `/10x-ui runs`'s pre-audit (recorded in `change.md`), what are these two views' concrete design-system-contract charges — missing tokens, missing shared components, accidental architecture — each with file:line evidence and user impact, to feed `/10x-plan`?

## Summary

Unlike dashboard (S-16) and simulation (S-17), these two views have **real** hardcoded-color hits: Recharts series colors (`PHASE_COLORS`, `RUN_COLORS`) are literal hex values. The repo's existing `--chart-1` through `--chart-5` tokens are unused and grayscale-only, which can't replace these colors' semantic meaning without a design decision — flagged as this change's one open question. Beyond that, the same sitewide nested-`<main>` architecture issue recurs here more severely (multiple early-return branches per file), plus a missing-focus-visible link-as-button pattern and a duplicated status-page shell.

## Charges

### Charge 1 — Chart series colors are hardcoded hex, existing chart tokens are grayscale-only and would erase semantic meaning

- **File:evidence**: `src/app/runs/[runId]/page.tsx:19-25` (`PHASE_COLORS`, 5 hex values: `#9ca3af` establishment, `#22c55e` growth, `#f59e0b` overshoot, `#ef4444` crash, `#38bdf8` recovery) and line 131 (`stroke="#38bdf8"` on the population `Line`); `src/app/runs/compare/page.tsx:24` (`RUN_COLORS`, 4 hex values, same palette cycled for up to 4 run-comparison bars).
- **Category**: Missing tokens
- **Evidence**: `src/styles/globals.css:85-89,121-125` already defines `--chart-1` through `--chart-5` (published via `@theme inline` as `--color-chart-1`..`5`), but every value is `oklch(<L> 0 0)` — a pure grayscale ramp (zero chroma), confirmed identical in both `:root` and `.dark`. `PHASE_COLORS`' mapping is semantically deliberate (green=growth is positive, red=crash is a warning color, matching `--destructive`'s own role), not an arbitrary per-file palette invention — a grayscale substitution would read as "5 shades of gray" with no way to tell crash from growth at a glance.
- **User impact**: Currently, colors work and convey meaning, but they're literal hex strings disconnected from the token system (a future dark-mode-divergence or rebrand would miss these two files silently) — this is the token-discipline gap, not a visual defect today.
- **Fix**: Open question — see "Open Questions" below. Not a mechanical "replace with `--chart-N`" because the existing tokens don't carry the right semantics.

### Charge 2 — Nested `<main>` landmark, more severe here (multiple early-return branches per file)

- **File:evidence**: `runs/[runId]/page.tsx:55,63,97` — three separate `<main className="from-primary to-background...">` roots (loading branch, error branch, main-content branch). `runs/compare/page.tsx:92,100,108,133` — four separate `<main>` roots (no-ids branch, loading branch, error branch, main-content branch).
- **Category**: Accidental architecture
- **Evidence**: Identical root cause to S-16/S-17's fixed Charge — `AppShell`'s `SidebarInset` already owns the one correct `<main>` landmark — but here it recurs **7 times total** across both files' multiple conditional-return branches, not just once per file.
- **User impact**: Screen-reader users see duplicate "main" landmarks on every page state (loading, error, and content), not just the happy path.
- **Fix**: Change every one of the 7 `<main>` roots to `<div>` — same classNames, same visual layout, same fix pattern as S-16/S-17.

### Charge 3 — Export links have no focus-visible treatment

- **File:evidence**: `runs/[runId]/page.tsx:104-109` ("Export JSON") and `:110-115` ("Export CSV") — bare `<Link className="bg-input text-foreground hover:bg-foreground/15 rounded-full px-4 py-1 font-semibold">`.
- **Category**: Missing shared component
- **Evidence**: Identical to S-16's Charge 1 — no `focus-visible` class exists on either link, while the shared `Button` component (via `asChild`) already provides one.
- **User impact**: Keyboard users tabbing through the analysis page see no visible focus indicator on either export action.
- **Fix**: Wrap both in `<Button asChild className="...">`, same pattern S-16 established and S-17 reused.

### Charge 4 — Duplicated "status page" shell across 6 early-return branches

- **File:evidence**: `runs/[runId]/page.tsx:54-58` (loading) and `:62-66` (error); `runs/compare/page.tsx:91-95` (no-ids), `:99-103` (loading), `:107-111` (error) — all six render the identical `<main className="from-primary to-background text-foreground flex min-h-screen flex-col items-center justify-center bg-gradient-to-b p-8"><p>...</p></main>` shell, differing only in the message text.
- **Category**: Missing shared component
- **Evidence**: Six copy-pasted blocks of the same wrapper+message pattern, across two files — the kind of duplication the audit's "copy-pasted form field" example describes, just for a status message instead of a form field.
- **User impact**: Not yet user-visible (each renders correctly today), but any future change to this status-shell's styling (e.g. adding a "back to dashboard" link to every error state) requires 6 synchronized edits.
- **Fix**: Extract a small `StatusMessage` component (message text in, consistent wrapper out) used by all 6 call sites. Lower priority than Charges 1-3 — `/10x-plan` can decide scope.

## Deferred (noted, not evaluated further here)

- None beyond Charge 4's own noted lower priority — `/10x-plan` decides its disposition, consistent with how S-17 handled its own lower-severity Charge 3.

## Code References

- `src/app/runs/[runId]/page.tsx:1-187` — the full analysis view under audit.
- `src/app/runs/compare/page.tsx:1-230` — the full comparison view under audit.
- `src/styles/globals.css:85-89,121-125` — the existing, unused, grayscale-only `--chart-1`..`5` tokens central to Charge 1's open question.
- `context/archive/2026-11-14-dashboard-restyle/` and `context/archive/2026-11-14-staging-live-view-restyle/` — the prior two S-16/S-17 changes whose `<main>`→`<div>` and `Button asChild` fixes this plan reuses verbatim.
- `AGENTS.md` (`## UI` section) — already carries the link-as-button and main-landmark rules from S-16; Charge 1's resolution (whichever way it goes) may warrant a one-line addition about chart-series colors specifically.

## Open Questions

- **Charge 1's resolution** — three real options exist, each with a real tradeoff, and none is a mechanical "obviously correct" choice: (a) extend `--chart-1`..`5` with actual hue (not just lightness) so they carry semantic categorical color and reusing them here becomes the right move; (b) leave `PHASE_COLORS`/`RUN_COLORS` as deliberately-named local constants (not "missing tokens" in the usual sense, since Recharts needs literal color strings anyway and the semantic mapping is domain logic, not a style preference); (c) move the literal values into a new `src/styles/theme-colors.ts`-adjacent file (the project already has a canvas-color exception file) specifically for chart-series colors, documented as intentional. `/10x-plan` must resolve this with the user before writing phases — it is this change's one genuine open decision.
