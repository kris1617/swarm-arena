---
change_id: staging-live-view-restyle
title: Restyle the simulation staging form and live view onto the F-06 design-system contract
status: archived
created: 2026-11-14
updated: 2026-11-14
archived_at: 2026-11-14T20:01:52Z
---

## Notes

Roadmap S-17 (M-3, "Modernization and polish"). Depends only on F-06 (`ui-design-system-foundation`, done, archived) — parallel with S-18/S-19/S-20, no dependency on S-15/S-16.

**Target view:** `src/app/simulation/page.tsx` (the staging form, running/saved-run switcher, and suggestion card), plus its two subcomponents `src/app/simulation/_components/server-run-viewer.tsx` and `src/app/simulation/_components/simulation-canvas.tsx`.

**Design-system variant:** Existing system (Tailwind v4 + shadcn/ui, the course variant), same as dashboard-restyle. Extend, don't fork.

**Pre-audit findings (10x-ui Step 2):**
- Hardcoded-value scan on `simulation/page.tsx` and `_components/*.tsx`: **zero hits** on styling code. The only `rgb(...)` matches are in `simulation-canvas.tsx`'s `colorToCss` helper (converts a boid's genetic-trait color to a canvas `ctx.fillStyle` string) and its test — this is runtime data visualization, not a design-token violation; `AGENTS.md` already carves out "Canvas-only color values live in `src/styles/theme-colors.ts`" as the accepted exception.
- This view is already in noticeably better shape than dashboard was: it already handles 4 distinct mutation error states (`savePauseMutation.error`, `resumeMutation.error`, `startRun.error`, `startServerMutation.error`, all rendered via `text-destructive`), already uses the shared `Input`/`Switch`/`Button` components throughout, and `ServerRunViewer` already handles its own connecting/error states cleanly.
- Same nested-`<main>` landmark issue as dashboard had (`simulation/page.tsx:221`), confirmed in dashboard-restyle's research as expected to recur here — this change fixes it for this view.
- 12 near-identical `<label>` + `<Input type="number">` blocks (lines 338-514) assembled by hand instead of a reusable composite — exactly the "copy-pasted form field" missing-shared-component signal the audit calls out.
- No loading indicator for `runningRunsQuery`/`savedRunsQuery` while their initial fetch is in flight — milder than dashboard's bug (nothing misleading renders, the sections just don't appear yet), but still a real 7-state-matrix gap.
- `AGENTS.md`'s UI section (extended by dashboard-restyle with the link-as-button and main-landmark rules) is current — this change will follow the same rules, not add new ones unless a new pattern emerges.
