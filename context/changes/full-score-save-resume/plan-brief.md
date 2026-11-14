# Full Scoring with Save and Resume — Plan Brief

> Full plan: `context/changes/full-score-save-resume/plan.md`
> Research: `context/changes/full-score-save-resume/research.md`

## What & Why

Closes out roadmap M-1's last slice: admin-defined parameter ranges
(FR-002), the real four-factor scoring formula including a new
population-lifecycle-phase factor and a correctness fix to the mislabeled
"genetic diversity" input (FR-010, FR-019), and exact-fidelity save/resume
for server-owned runs (FR-011, FR-012).

## Starting Point

All four pieces are confirmed unbuilt or wrong today (see `research.md`):
`adminProcedure` is defined but never used; the PRNG's state can't be
captured; `foodAvailabilityRatio` is computed and discarded;
"genetic diversity" scoring is actually spatial clustering; there's no
live-state persistence anywhere.

## Desired End State

Admin can set parameter ranges; every run's score is a real 4-factor
product; a server-owned run can be paused with exact state and resumed
later, bit-identical to where it left off.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Genetic diversity | Implement a real gene-variance metric; `computeCohesion` stays, no longer a score input | Fixes a real mislabeling already shipped in S-01/S-03 | User + Research |
| RNG persistence | Expose state directly via `createRng`'s return (callable + `getState`/`setState`), not call-count replay | O(1) resume; implemented as a backward-compatible callable-with-properties to avoid touching ~39 existing call sites | User (approach) + Plan (compatible shape) |
| Save vs. Stop | New "Save & Pause"/"Resume" pair, separate from the existing "Stop" | Zero risk to already-shipped Stop behavior | User |
| Phase quality reward | Time-weighted phase-health average + resilience bonus for Crash→Recovery | Rewards both sustained health and bouncing back, not just avoiding Crash | User |
| Combination | Equal 4th multiplicative factor | Matches FR-010's existing multiplicative structure; a weak factor proportionally drags the whole score | User |

## Scope

**In scope:** `createRng` state exposure, `adminSettings` table + admin
page + range-aware validation, `foodAvailabilityRatio` exposure, real
genetic-diversity metric, population-phase classifier, new `computeScore`,
`savePause`/`resume` for server-owned runs + UI.

**Out of scope:** save/resume for the client-staged canvas, changing
"Stop", admin managing other users' runs, FR-015/FR-016 (suggestions,
comparison UI).

## Architecture / Approach

Four ordered phases: (1) RNG state, zero blast radius by design; (2) admin
ranges, independent; (3) the scoring rewrite inside the one shared tick
core (`computeSingleRunTick`), so both client-staged and server-owned
paths get it automatically; (4) save/resume, depending on (1) and (3)'s
new state shapes.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. RNG state | `getState`/`setState` on the existing callable, no other call site touched | Confirming bit-identical replay |
| 2. Admin ranges | `adminSettings` table, admin page, range-aware `start`/`startServer` | First real use of `adminProcedure` anywhere |
| 3. Scoring rewrite | New 4-factor `computeScore`, phase classifier, genetic-diversity fix | Breaking signature change — every call site must update together |
| 4. Save/Resume | `savePause`/`resume` for server-owned runs + UI | Exact-fidelity proof: same population, food, RNG sequence |

**Prerequisites:** S-03, F-01 (both done, per roadmap).
**Estimated effort:** four phases; one schema migration (additive) per phase 2 and 4.

## Open Risks & Assumptions

- Assumes SQLite/Drizzle's enum addition (`"saved"`) and JSON-mode text
  columns need no interactive migration step beyond the schema change
  itself — confirm during Phase 2/4 implementation.
- Exact per-phase quality weights and the resilience-bonus magnitude are
  implementer's tuning calls, documented wherever chosen, per the PRD's
  explicit delegation.

## Success Criteria (Summary)

- A run's score genuinely changes based on resource management, real
  gene diversity, and phase history — not silently defaulting to the old
  formula.
- Resuming a saved server-owned run continues from bit-identical state.
- Nothing about the existing Stop flow or client-staged canvas changes.
