---
change_id: fix-production-trpc-error-logging
title: Production error visibility (tRPC, error boundary, instrumentation, races)
status: implemented
created: 2026-11-13
updated: 2026-11-13
archived_at: null
---

## Notes

Started as fix #1 from the observability audit
(context/audits/observability/2026-11-13_simulation-start-stop.md, finding
PL-1 / root cause #1), then expanded during planning to cover all six of the
report's §6 recommended fixes: tRPC onError (PL-1), a root error.tsx (PL-5),
instrumentation.ts (PL-3), missing onError handlers on post.create and both
stop mutations (PL-4, SS-3, SS-4), RAF tick try/catch on both run modes
(SS-2, SS-14), and the two TOCTOU races in simulation.ts's stop/start
(SS-7, SS-11).

See plan.md / plan-brief.md for the full scope, phase breakdown, and key
decisions (race semantics, UX for each new error state).
