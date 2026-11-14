---
change_id: parameter-suggestion-heuristic
title: Heuristic next-parameter suggestion correlated with final score
status: implementing
created: 2026-11-14
updated: 2026-11-14
archived_at: null
---

## Notes

Roadmap S-13 (M-2, 2026-11-14, "Insight and comparison"). Heuristic
design resolved 2026-11-14: optimizes toward the final combined score
(FR-010), correlating each of the 13 admin-ranged parameters (FR-002)
against the user's own past-run scores, suggesting the single
most-correlated one with a one-line rationale and a confidence
qualifier based on sample size (minimum 3 runs with that parameter
varied). No new unknowns. Prerequisite F-05 already done and archived.
