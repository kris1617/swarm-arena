---
date: 2026-11-20T05:18:22+01:00
researcher: Claude Sonnet 5
git_commit: 8d22b434d77188596cc5ef57808ffa274147178c
branch: master
repository: swarm-arena
topic: "/10x-ui audit of run-analysis and run-comparison views (S-48, M-12 UI modernization pass)"
tags: [research, codebase, runs, analysis, compare, ui, design-system, stat-section]
status: complete
last_updated: 2026-11-20
last_updated_by: Claude Sonnet 5
---

# Research: /10x-ui audit of the run-analysis and run-comparison views

**Date**: 2026-11-20T05:18:22+01:00
**Researcher**: Claude Sonnet 5
**Git Commit**: 8d22b434d77188596cc5ef57808ffa274147178c
**Branch**: master
**Repository**: swarm-arena

## Research Question

`/10x-ui`'s pre-audit on `src/app/runs/[runId]/page.tsx` (263 lines) and `src/app/runs/compare/page.tsx` (268 lines) — the highest-drift view group in M-12 (10 and 8 feature commits respectively since M-3's S-18 restyle) — found 0 hardcoded-value hits but a clear repeated-shell pattern. This research confirms the charge and scopes the fix.

## Summary

**1 charge, INCLUDE**: extract a shared `AnalysisCard` component replacing the repeated `<section className="bg-input text-foreground flex w-full max-w-2xl flex-col gap-2 rounded-2xl px-4 py-3"><h2 className="font-semibold">{title}</h2>{children}</section>` shell. Within this change's own 2 files, this exact shell appears **10 times**: 7 in `runs/[runId]/page.tsx` (6 stat sections — Run suggestion, Population over time, Genetic diversity over time, Time in each phase, Completed resilience cycles, Final genetic diversity — plus the conditional `wasAutoStopped` notice section) and 3 in `runs/compare/page.tsx` (Parameters, Score & factors, Factor breakdown). This far exceeds the extraction threshold `RunRow` (`dashboard-ui-refresh`) and `Tabs` adoption already established in this milestone (3+ call sites across 2+ views); here it's 10 call sites within 2 files in one change.

**No other charges confirmed.** Chart colors already comply with `AGENTS.md`'s `var(--chart-N)` rule (grep-confirmed both files use `var(--chart-1)` through `var(--chart-5)` exclusively, no local hex arrays). Both files already correctly use `StatusMessage` for their loading/error early-returns (confirmed — this is NOT a repeat of the dashboard/leaderboard inline-status-card pattern; these two views were already doing the right thing before this audit). `runs/compare/page.tsx`'s 4 notice-paragraph blocks (lines 138-175: errored-row notices, legacy-score notice, throttled notice, auto-stopped notice) differ enough in text/condition/className (`text-foreground/70` vs `text-foreground/70 text-sm`) that extracting them is a lower-value, more awkward abstraction than the clear `AnalysisCard` win — **DEFER**, stays as-is.

## Detailed Findings

### Charge 1 — Shared `AnalysisCard` component

- `src/app/runs/[runId]/page.tsx:147-154,156-191,193-212,214-236,238-251,253-260` — 6 sections, each `<section className="bg-input text-foreground flex w-full max-w-2xl flex-col gap-2 rounded-2xl px-4 py-3">` with an `<h2 className="font-semibold">{title}</h2>` immediately inside, followed by varying content (a paragraph, a chart, a list, a stat).
- `src/app/runs/[runId]/page.tsx:138-144` — the conditional `wasAutoStopped` notice section uses the identical shell (no `<h2>`, just a `<p>`), a minor variant (title optional).
- `src/app/runs/compare/page.tsx:181-197,199-243,245-263` — 3 more sections with the exact same shell + `<h2 className="font-semibold">{title}</h2>` pattern.
- grep count confirms 7 instances of the literal shell className string in `runs/[runId]/page.tsx` and 3 in `runs/compare/page.tsx` — 10 total within this change's scope, each differing only in title text and children content, not in any conditional logic. This is the "compose via props" shape `/10x-ui` asks for (title + children), not an awkward conditional pile.
- **Wider pattern, out of scope**: the same literal shell string also appears in `src/app/simulation/page.tsx` (3x) and `src/app/admin/elevation/_components/elevation-form.tsx` (2x) — confirmed via grep, not read in full. These are informational for a *future* change (S-49's admin-pages pass could adopt the same component), not touched here, per `/10x-ui`'s "one view(-group) per change" rule — this change limits its own extraction to the 2 files it audits.

### Non-charge — `StatusMessage` usage already correct

- `src/app/runs/[runId]/page.tsx:68-76` and `src/app/runs/compare/page.tsx:104-114` both already use `StatusMessage` for loading/error early-returns — the exact pattern `dashboard-ui-refresh`'s research confirmed these two files use (and thus the reason the dashboard/leaderboard inline-status-card pattern stayed at a ceiling of 2 instances, never reaching these files). No action needed.

### Non-charge — chart colors already compliant

- `src/app/runs/[runId]/page.tsx:23-28` (`PHASE_COLORS`) and `:169,181,204` (chart `stroke` props) and `src/app/runs/compare/page.tsx:28-33` (`RUN_COLORS`) and `:257` (`Bar fill`) all reference `var(--chart-1)` through `var(--chart-5)` exclusively — zero local hex arrays, fully compliant with `AGENTS.md`'s chart-token rule already.

## Code References

- `src/app/runs/[runId]/page.tsx:138-144,147-154,156-191,193-212,214-236,238-251,253-260` — the 7 shell instances this change extracts.
- `src/app/runs/compare/page.tsx:181-197,199-243,245-263` — the 3 shell instances this change extracts.
- `src/app/runs/[runId]/page.tsx:68-76`, `src/app/runs/compare/page.tsx:104-114` — confirmed-correct `StatusMessage` usage, not touched.
- `src/app/simulation/page.tsx`, `src/app/admin/elevation/_components/elevation-form.tsx` — same shell pattern exists here too (informational only; out of this change's scope).

## Architecture Insights

- This repo's observed local-vs-shared extraction threshold (established across `dashboard-ui-refresh`/`leaderboard-ui-refresh`): extract once 3+ call sites exist with composable, non-branching differences. This change's 10 call sites within its own 2 files clear that threshold with room to spare — this is the clearest extraction case in M-12 so far.
- Placing the new component at `src/components/analysis-card.tsx` (sibling to `src/components/run-row.tsx`) keeps the convention `dashboard-ui-refresh` established: new cross-view-reusable presentation components live under `src/components/`, not inlined in `src/app/`.

## Historical Context (from prior changes)

- `context/archive/2026-11-20-dashboard-ui-refresh/` and `context/archive/2026-11-20-leaderboard-ui-refresh/` — the two prior M-12 passes this change's component-placement convention and extraction-threshold reasoning draw on directly.
- `context/archive/2026-11-14-analysis-comparison-restyle/plan.md` — M-3's original restyle (S-18) that established the current shell pattern and token usage, now being re-audited.

## Related Research

- `context/archive/2026-11-20-dashboard-ui-refresh/research.md`, `context/archive/2026-11-20-leaderboard-ui-refresh/research.md` — sibling `/10x-ui` audits for the same milestone.

## Open Questions

- None blocking.

## Charges

| # | Category | Verdict | File:line | User impact |
|---|----------|---------|-----------|--------------|
| 1 | Missing shared component | **INCLUDE** (extract `AnalysisCard` at `src/components/analysis-card.tsx`, taking `title?` + `children`) | `src/app/runs/[runId]/page.tsx:138-260` (7 instances), `src/app/runs/compare/page.tsx:181-263` (3 instances) | No direct user-visible bug today; the clearest duplication in M-12 so far (10 call sites within 2 files) — prevents any future per-card style change from needing 10 hand-edits. |
| 2 | Local duplication (minor) | **DEFER** — compare page's 4 notice-paragraph blocks differ enough in text/className to not be a clean extraction; stays as-is. | `src/app/runs/compare/page.tsx:138-175` | None — avoids a forced, low-value abstraction. |
