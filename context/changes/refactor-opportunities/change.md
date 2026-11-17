---
change_id: refactor-opportunities
title: Refactor opportunities for sim-engine's technical debt (10xArchitect M4L4 artifact)
status: implementing
created: 2026-11-17
updated: 2026-11-17
archived_at: null
---

## Notes

10xArchitect badge artifact (M4L4, "Refaktoryzacja z Agentem"). We have an
analysis of this repository documenting technical debt and structural
risk: context/changes/sim-engine-feature-analysis/research.md. This
change answers the question that analysis deliberately left open: WHICH
of these problems is worth fixing, in what target shape, and in what
order. We explore each recorded problem in the code and its history, then
rank them as refactor opportunities.

This change proceeds in stages: exploration → decision and plan →
implementation. During exploration, no refactor happens and no decision
is made. Exploration's output: this change's research.md, ending in a
ranked list of options with trade-offs. Read the report first; the
decision on what to implement is made at the planning stage, and the
refactor only starts according to the accepted plan.

Candidates carried forward from the prior research (classified per the
lesson's own rule — a CANDIDATE is a problem whose fix would change code
structure; anything else, like a missing test, stays as feasibility/cost
input, not a candidate):
- §2.1 boids.ts → ~/styles/theme-colors boundary break (CANDIDATE)
- §2.2 computeSingleRunTick's two hand-synced call sites (CANDIDATE)
- §2.3 finishRun's history-literal duplicated at two call sites (CANDIDATE)
- §2.4 three test-coverage gaps (NOT a candidate — feasibility/cost input)
