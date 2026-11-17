# Confirm per-run history scope is forward-only — Plan Brief

> Full plan: `context/changes/confirm-run-history-retroactive-scope/plan.md`
> Research: `context/changes/confirm-run-history-retroactive-scope/research.md`

## What & Why

Roadmap slice S-37 (M-9), closing Open Roadmap Question #4: was F-05's
per-run history persistence supposed to apply retroactively to old
runs? Research confirmed the already-shipped forward-only behavior is
safe and intentional (no backfill path exists anywhere), and that
checking this surfaced one real bug worth fixing before formally
closing the question: the run-analysis page's "Final genetic diversity"
stat silently shows `0.000` for a history-less run, with no guard
distinguishing "no data" from a genuinely zero-diversity result.

## Starting Point

Every other section on `src/app/runs/[runId]/page.tsx` that depends on
`history` already guards on its truthiness and shows an accurate
"no data" message (population chart, genetic-diversity chart,
phase-tally, completed-cycles). The Final genetic diversity section is
the sole exception — `<p>{finalGeneticDiversity.toFixed(3)}</p>` with no
conditional, rendering the backend's null-safe default (`0`) as if it
were a real measured value.

## Desired End State

The Final genetic diversity section shows an accurate "no data" message
for history-less runs, matching the page's existing pattern exactly.
Open Roadmap Question #4 is marked resolved; roadmap slice S-37 is
`done`.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Fix location | Guard at the render site, not the API | The backend's `0` default is correct for other consumers; the bug is the one render site that doesn't check for it | Research + Plan |
| Guard pattern | `history ? ... : ...`, same shape as 3 sibling sections | Matches the page's own existing convention exactly, no new pattern introduced | Plan |
| Message text | Distinct from the diversity chart's existing message | Avoids showing identical text twice for two different things on one page | Plan |
| Scope | Single phase, no automated test added | Pure JSX conditional on an already-fetched field; manual verification against real null-history DB rows is the primary check | Plan |

## Scope

**In scope:**
- One guard fix on `src/app/runs/[runId]/page.tsx`'s Final genetic diversity section
- Formal closure of Open Roadmap Question #4
- Marking roadmap slice S-37 `done`

**Out of scope:**
- Changing `getRunAnalysis`'s backend default (correct for other consumers)
- Any other section of the run-analysis page (all already handle null history correctly)
- Dashboard, run-comparison, leaderboard, or export surfaces (research confirmed none need this guard)
- Any backfill mechanism for old runs' history (the forward-only behavior being confirmed, not reversed)

## Architecture / Approach

A one-line JSX conditional, copying an existing pattern already used
three times on the same page. No new data plumbing, no new query, no
schema change.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Guard fix + verification + closeout | The fix, verified against real null-history DB rows, plus roadmap closeout | None significant — small, pattern-matched UI fix |

**Prerequisites:** None.
**Estimated effort:** Well under 1 session — a one-line fix plus verification and two roadmap edits.

## Open Risks & Assumptions

- None significant. The fix is fully grounded in an existing, proven pattern on the same file.

## Success Criteria (Summary)

- A history-less run's Final genetic diversity section shows an
  accurate message instead of a misleading `0.000`.
- A history-present run's display is unaffected.
- Open Roadmap Question #4 is resolved; roadmap slice S-37 is `done`.
