---
change_id: runs-analysis-compare-ui-refresh
title: Run-analysis and run-comparison views modernization pass
status: archived
created: 2026-11-20
updated: 2026-11-20
archived_at: 2026-11-20T06:22:58Z
---

## Notes

Roadmap S-48 (M-12: UI modernization pass). The run-analysis (`runs/[runId]`) and run-comparison (`runs/compare`) pages were restyled onto the design-token system in M-3 (S-18) but have since picked up the highest accumulated drift of any view group in this milestone — 10 and 8 feature commits respectively (diversity-trend chart S-32, area-aware population insight S-25, corpus annotations S-33/S-35, the `wasEverThrottled` comparability marker S-36). This change re-audits both via `/10x-ui` against the current design-token contract, closes any drift, and leaves a rule so the next agent keeps using the tokens and components.
