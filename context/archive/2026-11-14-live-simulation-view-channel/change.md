---
change_id: live-simulation-view-channel
title: Live simulation-view channel (server push)
status: archived
created: 2026-11-14
updated: 2026-11-14
archived_at: 2026-11-14T10:45:48Z
---

## Notes

Roadmap F-04 (2026-11-14 extension to M-1). The server must be able to push a
running simulation's current tick state to exactly one connected viewer in
real time, without the viewer owning or affecting execution. Unlocks S-07
(view-running-server-simulation).

Grounded in F-03's `getLiveRunState(runId)` (server-run-registry.ts) and the
confirmed architecture decision: SSE/WebSocket push, not polling. tRPC v11
(already in package.json: @trpc/client/server/react-query ^11.0.0) has native
SSE subscription support (async-generator resolvers + `tracked()`), and the
existing route handler (`src/app/api/trpc/[trpc]/route.ts`) has no `runtime:
"edge"` override, so it already runs on the Node runtime that streaming SSE
needs. No new transport (WebSocket server, custom route) is required — this
stays inside the existing tRPC stack.

See `context/foundation/roadmap.md` F-04 for full Outcome/Risk/Unknowns.
