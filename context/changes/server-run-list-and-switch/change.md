---
change_id: server-run-list-and-switch
title: List and switch between running server simulations; retire old client switcher
status: implemented
created: 2026-11-14
updated: 2026-11-14
archived_at: null
---

## Notes

Roadmap S-08 (2026-11-14 extension to M-1), the last slice of this
extension. User sees all their currently-running server simulations and
switches which one is actively viewed, without interrupting the others —
the same capability S-05 already delivered, now backed by server execution
instead of a single shared client RAF loop. The old client-driven
multi-run switcher UI is retired as part of this slice.

Prerequisites: S-07 (done — `ServerRunViewer`/`watch` subscription already
exist and are reused unchanged here).

Retirement inventory (confirmed via grep — nothing outside this subsystem
references any of these):
- `src/app/simulation/multi/` (page.tsx, _components/multi-simulation-stage.tsx + .test.tsx) — deleted entirely.
- `src/server/simulation/multi-run-lifecycle.ts` + `.test.ts` — deleted entirely.
- `src/server/simulation/run-slots.ts` — trimmed to keep only `MAX_PARALLEL_RUNS` (still imported by `simulation.ts`'s cap check); `RunSlot`/`RunSlotsState`/`addSlot`/`setActive`/`markStopped`/`removeSlot` removed (only consumer was the retired multi-run page/component).
- `src/server/simulation/run-slots.test.ts` — deleted entirely (every test exercises a removed function; `MAX_PARALLEL_RUNS` itself was never independently asserted, only used as a loop bound in those tests).

See `context/foundation/roadmap.md` S-08 for full Outcome/Risk.
