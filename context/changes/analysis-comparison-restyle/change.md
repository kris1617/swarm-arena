---
change_id: analysis-comparison-restyle
title: Restyle the run-analysis and run-comparison pages onto the F-06 design-system contract
status: implemented
created: 2026-11-14
updated: 2026-11-14
archived_at: null
---

## Notes

Roadmap S-18 (M-3, "Modernization and polish"). Depends only on F-06 (done, archived) — parallel with S-16/S-17/S-19/S-20. The roadmap's own S-18 Outcome bundles two views (`runs/[runId]/page.tsx` analysis, `runs/compare/page.tsx` comparison) into one slice deliberately — overriding `/10x-ui`'s generic one-view-per-change default, since the roadmap decomposition already made this call.

**Target views:** `src/app/runs/[runId]/page.tsx`, `src/app/runs/compare/page.tsx`.

**Design-system variant:** Existing system (Tailwind v4 + shadcn/ui, the course variant), same as S-16/S-17.

**Pre-audit findings (10x-ui Step 2):**
- Hardcoded-value scan: **real hits this time**, unlike dashboard/simulation. `PHASE_COLORS` (`runs/[runId]/page.tsx:19-25`, 5 hex values) and `RUN_COLORS` (`runs/compare/page.tsx:24`, 4 hex values) are literal colors feeding Recharts series (`stroke`, `fill`, inline `style.backgroundColor`).
- `src/styles/globals.css` already has an unused `--chart-1` through `--chart-5` token set (confirmed in F-06's own plan notes) — but they're a **grayscale-only ramp** (`oklch(0.87 0 0)` through `oklch(0.269 0 0)`, zero chroma), while `PHASE_COLORS`/`RUN_COLORS` encode deliberate semantic meaning (green=growth, amber=overshoot, red=crash, blue=recovery) that a grayscale substitution would erase. This is a genuine design decision, not a mechanical token swap — flagged for `/10x-plan`'s interview.
- Both files duplicate the same nested-`<main>` landmark issue S-16/S-17 already fixed elsewhere — and more severely here: `runs/[runId]/page.tsx` has **3** separate `<main>`-rooted early-return branches (loading, error, main content) and `runs/compare/page.tsx` has **4** (no-ids, loading, error, main content), all needing the same `<main>`→`<div>` fix.
- `runs/[runId]/page.tsx:104-115`'s "Export JSON"/"Export CSV" links are styled as button-pills with no `focus-visible` treatment — the same missing-shared-component pattern S-16 fixed on the dashboard.
- The 6 total loading/error/empty early-return blocks across both files (3 in each) duplicate the exact same `<main className="from-primary to-background...">`+`<p>` shell — a copy-pasted "status page" pattern, not yet a shared component.
