---
change_id: leaderboard-ui-refresh
title: Leaderboard view modernization pass
status: impl_reviewed
created: 2026-11-20
updated: 2026-11-20
archived_at: null
---

## Notes

Roadmap S-47 (M-12: UI modernization pass). The leaderboard was restyled onto the design-token system in M-3 (S-19) but has since picked up 4 feature commits with no re-audit since. This change re-audits it via `/10x-ui` against the current design-token contract, closes any drift, and leaves a rule so the next agent keeps using the tokens and components. research.md from `dashboard-ui-refresh` (S-46, archived) already found that `src/app/leaderboard/page.tsx` shares the exact `RunRow`-shaped row (`bg-background flex items-center justify-between gap-2 rounded-full px-4 py-2`, same "Run #{id} — {boidCount} boids, {predatorCount} predators — started {date}" text) — `RunRow` was placed at `src/components/run-row.tsx` specifically so this change could adopt it without re-extracting.
