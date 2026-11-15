# Leaderboard — Plan Brief

> Full plan: `context/changes/leaderboard/plan.md`

## What & Why

Roadmap S-19 / PRD FR-026: the user should see their own completed simulation runs ranked by score, highest first — a distinct, unbounded, score-ordered view, separate from the existing 2-4-run comparison feature (FR-016).

## Starting Point

`simulation.listCompleted` already queries the user's own completed runs, but orders by start time, not score, and there's no page that ranks them. The dashboard's existing Completed section already renders runs with a nullable-score guard and links to each run's analysis page — this plan reuses that row-rendering shape rather than inventing a new one.

## Desired End State

A signed-in user opens "Leaderboard" from the sidebar and sees their own scored completed runs in descending-score order, numbered 1..N, with the top 3 visually distinguished. A run that errored before scoring (null score) is excluded here but still visible on the dashboard.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| Placement | Standalone page (`/leaderboard`) with sidebar nav entry | FR-026 frames this as a capability distinct from the dashboard's run lists; `app-shell.tsx` already reserves a `NAV_ITEMS` slot for it | Plan |
| Null-score runs | Excluded entirely | A "ranked by score" page has nothing valid to show for a run with no score | Plan |
| Result limit | Top 50, matching `listCompleted`'s existing cap | Consistency with the existing query's posture; no pagination exists yet | Plan |
| Tie-break | Most recent (`startedAt` desc) first | Matches `listCompleted`'s existing primary sort key as a familiar secondary ordering | Plan |
| Top-3 visual style | Token-based highlight (border/background accent) | More "leaderboard-y" without inventing a literal color or new component | Plan |
| Nav entry | Sidebar link | Standard discoverability, consistent with every other standalone page in this app | Plan |

## Scope

**In scope:** new `listLeaderboard` tRPC query; new `/leaderboard` page; sidebar nav entry.

**Out of scope:** cross-user ranking, pagination, any change to `listCompleted` or the dashboard's existing Completed section, new DB columns/migrations, new shared Table/Card components.

## Architecture / Approach

One new read-only query (ownership-scoped, score-filtered, score-then-startedAt ordered) feeding one new client-component page that mirrors the dashboard's existing loading/error/empty/data-row pattern, plus one new sidebar nav array entry.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Backend query | `listLeaderboard` procedure, ordered by score desc | Low — same shape as an existing, working query |
| 2. Leaderboard page + nav wiring | New page + sidebar entry | Low — reuses dashboard's exact row/state pattern; must not skip the `isError` state (lessons.md) |

**Prerequisites:** F-06 (shared app shell + tokens) — already done and archived.
**Estimated effort:** ~1 session across 2 phases.

## Open Risks & Assumptions

- Assumes exact score ties are rare (score is a `real` computed from several weighted sub-scores) — the tie-break is specified but not expected to matter often in practice.
- The sidebar `NAV_ITEMS` comment also names S-20; Phase 2 should check at implementation time whether S-20 has landed and adjust/remove the comment accordingly rather than leaving a stale reference.

## Success Criteria (Summary)

- A user with completed, scored runs sees them ranked highest-first on a new `/leaderboard` page, reachable from the sidebar.
- A completed run with no score never appears on the leaderboard, but remains visible elsewhere (dashboard).
- The page shows a real loading, error, and empty state — none dismissed as N/A.
