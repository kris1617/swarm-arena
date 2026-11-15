---
change_id: leaderboard
title: Leaderboard of the user's completed runs ranked by score
status: implemented
created: 2026-11-14
updated: 2026-11-15
archived_at: null
---

## Notes

Roadmap S-19 (M-3, "UI modernization"). Prerequisite F-06 (shared app shell + design tokens) is done and archived (`context/archive/2026-11-14-ui-design-system-foundation/`). PRD ref FR-026. Parallel with S-16–S-18, S-20 (all already done/archived except S-20).

**Outcome**: User sees a leaderboard of their own completed runs, ranked by score, highest first.

**Roadmap's own risk note**: Low — net-new page, built directly on F-06's shell with no prior page to preserve; reuses the same ownership-scoped query pattern every other run-listing query in this router already follows.
