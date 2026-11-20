---
date: 2026-11-20T07:24:31+01:00
researcher: Claude Sonnet 5
git_commit: dd445ea8377e39112a471718ae9fb0a51ae92daa
branch: master
repository: swarm-arena
topic: "/10x-ui audit of the admin elevation and settings views (S-49, M-12 UI modernization pass)"
tags: [research, codebase, admin, ui, design-system, number-field, landmark]
status: complete
last_updated: 2026-11-20
last_updated_by: Claude Sonnet 5
---

# Research: /10x-ui audit of the admin pages

**Date**: 2026-11-20T07:24:31+01:00
**Researcher**: Claude Sonnet 5
**Git Commit**: dd445ea8377e39112a471718ae9fb0a51ae92daa
**Branch**: master
**Repository**: swarm-arena

## Research Question

`/10x-roadmap`'s M-12 charter (and `dashboard-ui-refresh`'s research) asserted the admin pages (`src/app/admin/elevation/page.tsx`, `src/app/admin/settings/page.tsx`) "never received M-3's F-06 restyle at all." This research re-examines that claim directly against the current code and identifies the audit's real charges.

## Summary

**Correction to the roadmap's own prior claim**: both admin pages and their form components (`elevation-form.tsx`, `admin-settings-form.tsx`) already use the design-token system correctly — the hardcoded-value scan found 0 hits across all 4 files, and every `Button`/`Input` usage matches the established `bg-input`/`bg-background`/`rounded-full` token idiom used everywhere else in this repo. The roadmap's "never restyled" framing was inaccurate as a token-usage claim; these components must have adopted the tokens independently at build time (both ship with `isEffectivelyAdmin`/`elevateSelf`-era comments referencing FR-030/S-04, well after F-06 landed), even though neither went through an explicit `/10x-ui`-style restyle pass.

**2 real charges confirmed, both INCLUDE**:

1. **Landmark violation**: `src/app/admin/settings/page.tsx:20` uses `<main className="...">` as its root element — a direct violation of `AGENTS.md`'s already-documented rule ("A page's own root element... must be a `<div>`, never another `<main>`"). `AppShell`'s `SidebarInset` already renders the page's one `<main>` landmark; this is a genuine bug (two nested `<main>` landmarks), not a style nit, and the clearest real finding in M-12 so far — every other audited view in this milestone already got this right.
2. **Missing shared component**: `src/app/admin/settings/_components/admin-settings-form.tsx` hand-rolls 17 `<label>+<Input>` blocks (3 per ranged parameter × 5 parameters, plus 2 more for the object-count fields) that map directly onto `src/components/ui/number-field.tsx`'s `NumberField` component — a component `AGENTS.md` explicitly names as the pattern for exactly this signal ("A hand-copied `<label>`+`<Input>` block repeated across many fields is a missing-shared-component signal — see `src/components/ui/number-field.tsx`"), already adopted elsewhere (`src/app/simulation/page.tsx` and its sub-components). `src/app/admin/elevation/_components/elevation-form.tsx` has 2 more number inputs (self-duration, target-duration) with the same shape. `NumberField` needs one small widening — an optional `className` merged via `cn()` (the same established pattern `RunRow` and `AnalysisCard` already use) — to support the settings form's compact, fieldset-nested variant (`bg-transparent ... px-3 py-1` vs. the component's current hardcoded `bg-input ... px-4 py-2`).

## Detailed Findings

### Charge 1 — `admin/settings/page.tsx`'s `<main>` root

- `src/app/admin/settings/page.tsx:20` — `<main className="from-primary to-background text-foreground flex min-h-screen flex-col items-center justify-center gap-8 bg-gradient-to-b p-8">`.
- `AGENTS.md`'s UI section: "`AppShell`'s `SidebarInset` (mounted in `layout.tsx` for every authenticated page) already renders the page's one `<main>` landmark... must be a `<div>`, never another `<main>`... All of `dashboard/page.tsx`, `simulation/page.tsx`, and `runs/*` pages now follow this." Admin pages are not named in that list — confirmed, this one was missed.
- `src/app/admin/elevation/page.tsx:16` — already correctly uses `<div>`, not `<main>`. Only `settings/page.tsx` has the bug.

### Charge 2 — `NumberField` adoption

- `src/app/admin/settings/_components/admin-settings-form.tsx:64-121` — 5 `<fieldset>` blocks (one per `RANGED_PARAMETER_NAMES` entry), each with 3 hand-rolled `<label>+<Input>` blocks (min/default/max), all sharing the exact same compact className (`text-foreground h-auto rounded-full border-0 bg-transparent px-3 py-1`) — 15 instances.
- `src/app/admin/settings/_components/admin-settings-form.tsx:122-146` — 2 more `<label>+<Input>` blocks (max-object-count, max-concurrent-object-count) using `bg-input text-foreground h-auto rounded-full border-0 px-4 py-2` — this is `NumberField`'s exact current default className, so these 2 need zero widening to adopt `NumberField` as-is.
- `src/app/admin/elevation/_components/elevation-form.tsx:49-60,103-114` — self-duration and target-duration inputs, both number type with min/max, same `bg-input ... px-4 py-2` className as `NumberField`'s default — adopt with zero widening needed.
- `src/components/ui/number-field.tsx:1-37` — `NumberField({ label, id, min, max, step?, value, onChange })`, hardcoded `className="bg-input text-foreground h-auto rounded-full border-0 px-4 py-2"` on the inner `Input`, no override point today — same gap `RunRow` had before `leaderboard-ui-refresh` widened it.
- `src/app/simulation/page.tsx` and its sub-components already use `NumberField` extensively (grep-confirmed) — this change's widening must not break those existing callers, none of which pass a `className` today (confirmed by reading `NumberField`'s current signature — no such prop exists yet for any caller to pass).

### Non-charge — `target-email` text input (elevation-form)

- `src/app/admin/elevation/_components/elevation-form.tsx:93-102` — a single `type="email"` text input with a label, same shape family but not a `NumberField` (no min/max/number semantics) and the only text-input instance in either form. One occurrence does not meet this repo's observed extraction threshold (3+ call sites) — stays as-is.

### Non-charge — inline "Loading..."/"Saved." text

- `src/app/admin/settings/_components/admin-settings-form.tsx:34,158` — plain `<p>` loading/success text, not a `Skeleton`/shared-component gap. This is a single small form fetch, not a list-loading pattern like dashboard/leaderboard's `Skeleton` usage; no other view in this repo has an equivalent inline-form-loading pattern to compare against, so there's no confirmed duplication to extract. Stays as-is.

## Code References

- `src/app/admin/settings/page.tsx:20` — the `<main>` landmark bug.
- `src/app/admin/settings/_components/admin-settings-form.tsx:64-146` — the 17 `NumberField`-shaped instances.
- `src/app/admin/elevation/_components/elevation-form.tsx:49-60,103-114` — the 2 more `NumberField`-shaped instances.
- `src/components/ui/number-field.tsx:1-37` — `NumberField`, needs the `className` widening.
- `src/app/simulation/page.tsx` — confirmed existing `NumberField` callers, the regression surface for the widening.
- `AGENTS.md` — the landmark rule (already documents the convention; this change just fixes a missed instance, no new rule needed) and the `NumberField` signal rule (already documents the pattern; no new rule needed here either — this change is about *applying* existing rules, not writing new ones).

## Architecture Insights

- This is the first M-12 audit where the "never touched by M-3" framing from the roadmap/prior research turned out to be only half right: token usage was already correct (confirmed via the scan), but shared-component adoption and the landmark rule were not. The lesson generalizes: a prior research note's "never restyled" claim should be re-verified against current code before being treated as settled, since components can independently adopt tokens (or not) outside of any single named restyle milestone.
- The `NumberField` widening follows the exact precedent `RunRow` (`dashboard-ui-refresh`→`leaderboard-ui-refresh`) and no new precedent is needed for `AnalysisCard` (which needed no widening) — optional `className` merged via `cn()`, backward-compatible by construction since no existing caller passes one.

## Historical Context (from prior changes)

- `context/archive/2026-11-20-dashboard-ui-refresh/research.md` — originated the "admin pages never restyled" claim this research corrects (it was a reasonable inference at the time, scoped only to dashboard's own needs, not independently verified against the admin files directly).
- `context/archive/2026-11-20-leaderboard-ui-refresh/` — the `className`-widening precedent this change's `NumberField` fix follows.

## Related Research

- `context/archive/2026-11-20-dashboard-ui-refresh/research.md`, `context/archive/2026-11-20-leaderboard-ui-refresh/research.md`, `context/archive/2026-11-20-runs-analysis-compare-ui-refresh/research.md` — sibling `/10x-ui` audits for the same milestone.

## Open Questions

- None blocking.

## Charges

| # | Category | Verdict | File:line | User impact |
|---|----------|---------|-----------|--------------|
| 1 | Accidental architecture | **INCLUDE** (fix the landmark violation) | `src/app/admin/settings/page.tsx:20` | Two nested `<main>` landmarks on this one page is invalid for assistive tech — a real accessibility bug, not a style nit. |
| 2 | Missing shared component | **INCLUDE** (adopt `NumberField`, widened with an optional `className` merged via `cn()`) | `src/app/admin/settings/_components/admin-settings-form.tsx:64-146` (17 instances), `src/app/admin/elevation/_components/elevation-form.tsx:49-60,103-114` (2 instances) | No direct user-visible bug; prevents any future per-field style change from needing 19 hand-edits across 2 files. |
