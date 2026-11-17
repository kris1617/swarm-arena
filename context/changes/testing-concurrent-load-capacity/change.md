---
change_id: testing-concurrent-load-capacity
title: Concurrent-load capacity test
status: planned
created: 2026-11-17
updated: 2026-11-17
archived_at: null
---

## Notes

Open a change folder for rollout Phase 9 of context/foundation/test-plan.md:
"Concurrent-load capacity test". Risks covered: #9 (aggregate concurrent-run
load — multiple server-owned simulations competing for one CPU core, bounded
only by maxConcurrentObjectCount — never exercised by any automated test).
Test types planned: integration.

Risk response intent: extend Phase 8's single-process benchmark harness to
actually drive N real server-owned simulation runs concurrently (via the
real setInterval/registry scheduler this time, not Phase 8's single-process
interleaving stand-in), and prove no backlog, leak, or drop occurs up to the
documented maxConcurrentObjectCount ceiling.
