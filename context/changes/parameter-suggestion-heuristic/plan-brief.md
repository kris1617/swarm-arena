# Heuristic next-parameter suggestion — Plan Brief

> Full plan: `context/changes/parameter-suggestion-heuristic/plan.md`

## What & Why

Roadmap S-13, the last item in M-2. Suggest the one parameter most correlated with the user's own final score across their past runs, shown on the staging page right before they configure their next run — closing FR-015, the last of the three nice-to-have FRs M-1 deferred.

## Starting Point

All 13 ranged parameters and `score` already exist as plain columns on `simulationRuns`, persisted since S-04. No correlation/statistics logic exists anywhere in this codebase yet.

## Desired End State

On `/simulation`'s staging page, the user sees either a one-parameter suggestion with direction, rationale, and confidence, or "not enough data yet." Advisory only — never auto-fills the form.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| What it optimizes toward | Final combined score, not an isolated factor | Already resolved product decision — see PRD FR-015 | Prior (user, 2026-11-14) |
| Suggestion shape | One parameter, direction, rationale, confidence qualifier | Already resolved — "heuristic, not full optimization" | Prior (user, 2026-11-14) |
| Minimum sample size | 3 runs with the parameter varied | Already resolved threshold from the PRD resolution | Prior (user, 2026-11-14) |
| UI placement | `/simulation` staging page, not the dashboard or analysis view | The moment it's actually actionable — right before configuring the next run | Plan |
| Auto-fill vs. advisory-only | Advisory text only, never auto-fills the form | Matches "heuristic, not optimizer" — the user decides | Plan |
| Correlation method | Pearson correlation coefficient per parameter, pick the strongest `|r|` | Simplest statistically-grounded method; no new dependency needed | Plan |
| Architecture | Plain, framework-free `suggestParameterChange` function + a thin tRPC query | Mirrors this project's established pattern (same discipline as `run-export.ts`) | Plan |

## Scope

**In scope:**
- `suggestParameterChange` — plain correlation/selection function, unit-tested directly.
- `getParameterSuggestion` tRPC query — caller's-own-runs-only, no new DB writes.
- A suggestion card on `/simulation`'s staging page.

**Out of scope:**
- Auto-filling the staging form from the suggestion.
- A ranked list of multiple suggestions.
- Suggestion history/persistence.
- Any change to the dashboard, analysis view, or comparison view.

## Architecture / Approach

Plain correlation function (framework-free, directly testable) + a thin tRPC query that fetches the caller's own completed runs and delegates to it. Two phases: backend, then the UI card.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Backend | `suggestParameterChange` + `getParameterSuggestion` query, fully tested | Getting the Pearson correlation and confidence thresholds right |
| 2. UI card | A suggestion card on the staging page | Keeping it advisory-only, not accidentally wiring it to auto-fill |

**Prerequisites:** None beyond S-04 (done, archived) — this reads columns that have existed since then; F-05 is not actually needed (no `history` read).
**Estimated effort:** 2 phases, similar scope to S-14's.

## Open Risks & Assumptions

- Pearson correlation on a small sample (3-10 runs) is statistically noisy — the confidence qualifier exists specifically to communicate this, not to hide it. A "low confidence" suggestion is still shown, never suppressed.
- Assumes the user varies parameters between runs at all; a user who never changes defaults will only ever see "not enough data" (expected, not a bug).

## Success Criteria (Summary)

- A user with enough varied completed runs sees a correct, correctly-directioned suggestion on the staging page.
- A user without enough data sees a clear "not enough data yet" message, never a crash or a misleading guess.
- The suggestion never alters the form's current values.
