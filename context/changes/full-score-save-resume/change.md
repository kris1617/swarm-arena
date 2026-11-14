---
change_id: full-score-save-resume
title: Full scoring with save and resume
status: preparing
created: 2026-11-14
updated: 2026-11-14
archived_at: null
---

## Notes

Roadmap S-04 (M-1's last open slice, just unblocked 2026-11-14). User
configures the full parameter set within admin-defined ranges, can stop
and save a run at any point, resume it later with exact population/
resource state, and receives a complete score combining survival, resource
management, genetic diversity, and population-lifecycle-phase quality
(FR-019, new).

Scoring formula resolved in `context/foundation/prd.md` (v2, 2026-11-14):
score = survival × resourceManagement × geneticDiversity × phaseQuality
(equal product of four factors). Phase quality rewards both time-weighted
average phase health AND a resilience bonus for Crash→Recovery. Exact
per-phase weights and bonus magnitude are this change's planning-level
decision, not a product open question.

PRD refs: FR-002 (full — admin-defined parameter ranges, not yet built at
all per the roadmap baseline), FR-010 (full), FR-011, FR-012, FR-019,
US-01 (full).

Needs research before planning: does any admin-range-setting mechanism
exist today (FR-002 full)? What persists today vs. what "exact fidelity"
save/resume actually requires? What tick-level state would a population-
lifecycle-phase classifier need that doesn't exist yet?
