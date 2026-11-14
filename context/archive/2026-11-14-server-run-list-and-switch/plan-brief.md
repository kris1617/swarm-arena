# List and Switch Between Running Server Simulations — Plan Brief

> Full plan: `context/changes/server-run-list-and-switch/plan.md`

## What & Why

Add a `listRunning` query and a switcher UI, letting the user pick which of
their running server simulations `ServerRunViewer` watches — then retire
the old client-driven multi-run subsystem it replaces. Roadmap Slice S-08,
closing out the 2026-11-14 extension.

## Starting Point

S-07 already lets the user view exactly one run (the one they just
started). Nothing lists all running runs or lets the user switch between
them. The old `/simulation/multi` feature does something similar via a
client RAF loop — confirmed via grep to be a self-contained, deletable
subsystem except for one shared constant (`MAX_PARALLEL_RUNS`).

## Desired End State

A list of all currently-running server simulations, switchable via
`ServerRunViewer`, with switching never affecting execution.
`/simulation/multi` no longer exists.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| List freshness | Polled `useQuery` (2s interval), not SSE | The list changes rarely; a second subscription type would be overkill | Plan |
| Retirement scope | Delete the whole multi-run subsystem except `MAX_PARALLEL_RUNS` | Confirmed via grep that nothing else references the rest | Plan |
| New-run UX | Auto-set `viewingRunId` on `startServer` success | User sees their own run immediately, no 2s poll wait | Plan |

## Scope

**In scope:** `listRunning` query, list/switch UI in `page.tsx`, deleting
`/simulation/multi` + `multi-run-lifecycle.ts` + most of `run-slots.ts`.

**Out of scope:** stopping a run from the list (no stop button anywhere
yet), changing `ServerRunViewer`/`watch`/`startServer`.

## Architecture / Approach

`listRunning` reads the caller's own `"running"` rows. The UI renders them
as buttons; clicking sets `viewingRunId`, which `ServerRunViewer` (S-07,
unchanged) already knows how to watch. Retirement is a pure deletion pass
plus trimming one file to its one still-needed export.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Query + UI + retirement | Working switcher; old subsystem gone | Confirming the retirement deletion is truly clean (no stray import) |

**Prerequisites:** S-07, done.
**Estimated effort:** single phase; no schema change; net code reduction.

## Open Risks & Assumptions

- Assumes no external bookmark/link depends on `/simulation/multi`'s URL —
  confirmed no in-app nav points at it; an external bookmark is outside
  this plan's control.

## Success Criteria (Summary)

- Multiple running server simulations are listed and individually
  switchable without affecting each other's execution.
- The old subsystem is fully gone with no dangling imports.
