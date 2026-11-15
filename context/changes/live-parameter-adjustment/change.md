---
change_id: live-parameter-adjustment
title: Live-adjust flocking weights and food/threshold on a running simulation
status: implementing
created: 2026-11-15
updated: 2026-11-15
archived_at: null
---

## Notes

Roadmap S-27 (M-5, "Live in-run parameter adjustment"). North star of M-5 — the only slice in this milestone.

**Outcome**: User changes a server-owned run's separation/alignment/cohesion weights, food regen rate, and protection threshold while it is actively running, and sees the effect reflected in the live view within the next tick — not just at start time.

**Scoped to server-owned runs only.** Client-staged live adjustment and population-shape parameter adjustment (boidCount/flockCount/crossbreedingEnabled) are explicitly parked — see `context/foundation/roadmap.md`'s `## Parked` section.

**Baseline (confirmed via codebase investigation, 2026-11-15)**: live parameter adjustment is absent on both execution paths today. `server-run-registry.ts`'s `LiveRun.params` is set once at construction and only ever read inside `tick()` — no mutator exists, and no tRPC mutation updates a running run's params. Because `LiveRun.params` is already a single mutable object field read fresh every 16ms tick, adding a mutator + a tRPC mutation is additive — no new Foundation needed.

**Open decisions for `/10x-plan`** (all non-blocking per the roadmap):
- Validate live changes against `admin_settings.parameterRanges` (the existing mechanism `start`/`stop` already enforce) or allow exceeding them for a runtime tweak?
- Record a live change in the run's persisted `history` (so a completed run's analysis view shows what changed mid-run) or treat it as a pure runtime-only tweak with no trace?
- UI mechanism — inline editable panel on the live-view page, or a separate control surface?

**Real risk**: concurrency correctness — `tick()` runs on a 16ms `setInterval` per run, so a tRPC mutation writing `run.params` must not race a tick already in flight.
