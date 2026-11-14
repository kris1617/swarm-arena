---
change_id: post-run-optimization-suggestion
title: Run-specific optimization suggestion on the analysis view
status: archived
created: 2026-11-14
updated: 2026-11-14
archived_at: 2026-11-14T20:52:41Z
---

## Notes

Roadmap S-21 (M-3, "Modernization and polish"). No prerequisites — ready, parallel with everything else in M-3. PRD ref FR-027.

Outcome: a completed run's analysis view (`src/app/runs/[runId]/page.tsx`) shows a suggestion derived from that single run's own phase/resource history — distinct from S-13's already-shipped cross-run suggestion (`src/server/simulation/parameter-suggestion.ts`, the "Suggestion" card on `/simulation`, which correlates across the user's past runs). This is "reason about one run's own trajectory," not "correlate across many runs."
