---
change_id: area-aware-population-insight
title: Area-aware population insight (new 5th score factor)
status: implemented
created: 2026-11-15
updated: 2026-11-15
archived_at: null
---

## Notes

Roadmap S-25 (M-4, "Area, camera, and ops limits"). Prerequisite S-24
(configurable-area-and-camera-view) is done and archived
(`context/archive/2026-11-15-configurable-area-and-camera-view/`).
Parallel with S-26 (also done).

**Outcome**: User sees, in a completed run's analysis view, whether
population health held up given the area that run used — e.g., confirming
that increasing the area didn't just thin the population out without the
scoring/analysis reflecting why.

**Resolved decisions (from roadmap planning, 2026-11-15)**:
- Shape: a new, fifth score factor (not a display-only note or chart) —
  reopens FR-010/FR-019's "four-factor product" formula into a five-factor
  one.

**Roadmap's own risk note**: Medium — a fifth score factor changes every
existing scored run's *comparability* against future ones (same concern
FR-010/FR-019's prior resolution had to address) and touches the
leaderboard (S-19), run comparison (S-12), and parameter-suggestion
heuristic (S-13) — all of which read the score as a single comparable
number today. `/10x-plan` must treat this with the same care S-09's prior
phase-quality correction required — a scoring-formula change, not a
cosmetic addition.
