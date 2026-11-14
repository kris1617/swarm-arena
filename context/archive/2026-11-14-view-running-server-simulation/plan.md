# View One Running Server Simulation Implementation Plan

## Overview

Add a canvas viewer that renders a server-run simulation's live tick state,
driven entirely by F-04's `simulation.watch` SSE subscription — no local
tick loop, no ownership of execution. Reached from S-06's confirmation
panel via a "View live" action. This is roadmap Slice S-07.

## Current State Analysis

- `src/app/simulation/_components/simulation-canvas.tsx:113-157` —
  `drawScene(ctx, boids, predators)` is already a pure rendering function
  (clears the canvas, sorts entities by depth, draws each as a triangle or
  diamond). Not exported today; this plan exports it for reuse, no behavior
  change.
- `src/app/simulation/_components/simulation-canvas.tsx:19-20` —
  `CANVAS_WIDTH`/`CANVAS_HEIGHT` are local consts (600×400); exported for
  the new viewer to match the existing canvas's dimensions exactly rather
  than duplicating the numbers.
- `src/server/api/routers/simulation.ts`'s `watch` subscription (F-04, done)
  streams `LiveRunSnapshot` (`{ boids, predators, elapsedSeconds, populationCapped }`)
  via `tracked()`.
- `src/app/simulation/page.tsx` (S-06, done) — `serverRunConfirmation` state
  shows "Server run #{id} started ... Viewing it live is a future update."
  This plan fulfills that promise.

### Key Discoveries:

- **Correction made during planning, before any code was written**: tRPC's
  client-side `onData` for a `tracked()`-wrapped subscription does NOT
  receive the raw yielded value. It receives `TrackedData<T>`, i.e.
  `{ id: string; data: T }` — confirmed via
  `node_modules/@trpc/server/dist/unstable-core-do-not-import-B8epiErP.d.cts:379-388`
  (`interface TrackedData<TData> { id: string; data: TData }`) and
  `inferTrackedOutput`'s mapping at the same file's line 402. A viewer
  written against the raw snapshot shape (`onData: (snapshot) => ...snapshot.boids...`)
  would read `undefined` for every field. The contract below reads
  `onData: ({ data }) => ...`.
- `useSubscription`'s `enabled` option is deprecated in favor of simply not
  mounting the component (or `skipToken`) — this plan avoids the question
  entirely by only mounting `ServerRunViewer` once a `runId` is already
  known (never with a null/undefined runId), so no conditional-subscribe
  logic is needed at all.
- `simulation-canvas.test.tsx` and `multi-simulation-stage.test.tsx`
  establish this project's pattern for testing a tRPC-React component
  without a real provider: `vi.mock("~/trpc/react", () => ({ api: { simulation: { <procedure>: { useMutation: (options) => { captured = options; return {...} } } } } }))`, capturing the hook's options so the test can invoke
  them directly. This plan's test does the same for `useSubscription`.

## Desired End State

Clicking "View live" on the confirmation panel renders a canvas that
updates as the server pushes new tick state — the user watches a
simulation they are not executing. Verify: with a server run actually
ticking (via F-03's engine), the subscribed `onData` callback is invoked
with advancing `elapsedSeconds`, and `drawScene` is called with each
pushed frame's boids/predators.

## What We're NOT Doing

- Not building a list of all currently-running server simulations or a
  switcher between them — that's S-08.
- Not adding any way to stop a server run from this viewer — S-08's job.
- Not changing `drawScene`'s rendering logic, only exporting it.
- Not changing the client-staged `SimulationCanvas` component at all.
- Not adding reconnection/backoff logic beyond what `httpSubscriptionLink`
  already provides out of the box — if that turns out insufficient in
  practice, it's a follow-up, not part of proving this slice's core
  capability.

## Implementation Approach

Export `drawScene`, `CANVAS_WIDTH`, `CANVAS_HEIGHT` from
`simulation-canvas.tsx`. Add a new component, `ServerRunViewer`, whose only
job is: own a canvas ref, call `api.simulation.watch.useSubscription({runId}, {onData: ({data}) => drawScene(ctx, data.boids, data.predators), onError: ...})`,
and render a status line (connecting / error) alongside the canvas. Wire
`page.tsx`'s confirmation panel with a "View live" button that sets a new
`viewingRunId` state; when set, render `<ServerRunViewer>` instead of the
plain confirmation text, with a "Stop viewing" button that just unmounts it
(closing the subscription) — execution continues server-side regardless.

## Phase 1: `ServerRunViewer` component + "View live" wiring

### Overview

Export the reusable rendering primitives, build the viewer component, wire
it into the confirmation panel, and prove the subscription-to-canvas path
works without a local tick loop.

### Changes Required:

#### 1. Export rendering primitives

**File**: `src/app/simulation/_components/simulation-canvas.tsx`

**Intent**: Let the new viewer reuse the exact same rendering logic and
canvas dimensions the staging canvas already uses, with zero duplication.

**Contract**: Add `export` to `function drawScene(...)`, `const CANVAS_WIDTH = 600`, `const CANVAS_HEIGHT = 400`. No behavior change — these are already pure/constant.

#### 2. `ServerRunViewer` component

**File**: `src/app/simulation/_components/server-run-viewer.tsx` (new)

**Intent**: Render a server-run simulation's live tick state from pushed
SSE snapshots, with no local execution of any kind.

**Contract**:
- `ServerRunViewer({ runId, onClose }: { runId: number; onClose: () => void })`
- A `canvasRef` of `CANVAS_WIDTH`×`CANVAS_HEIGHT`.
- `const { status, error } = api.simulation.watch.useSubscription({ runId }, { onData: ({ data }) => { const ctx = canvasRef.current?.getContext("2d"); if (ctx) drawScene(ctx, data.boids, data.predators); }, onError: (err) => setViewError(err.message) })`
  — per the Key Discoveries correction, `onData`'s parameter is
  `{ id, data }`, not the snapshot directly.
- Local `useState<string | null>` for `viewError`, set from `onError`,
  rendered as a `text-destructive` paragraph when non-null (same pattern
  `page.tsx` already uses for mutation errors).
- Renders the canvas, a status line driven by the subscription's own
  `status` field (`"connecting"`/`"pending"`/`"error"`, mapped to plain
  text — no new design needed, just don't leave it silent), and a "Stop
  viewing" button calling `onClose`.

#### 3. "View live" wiring

**File**: `src/app/simulation/page.tsx`

**Intent**: Let the user reach the viewer from the confirmation panel S-06
already shows, fulfilling the "Viewing it live is a future update" promise.

**Contract**:
- Add `const [viewingRunId, setViewingRunId] = useState<number | null>(null)`.
- In the `serverRunConfirmation` panel, add a "View live" button calling
  `setViewingRunId(serverRunConfirmation.runId)`.
- When `viewingRunId` is non-null, render
  `<ServerRunViewer runId={viewingRunId} onClose={() => setViewingRunId(null)} />`
  instead of the plain confirmation text (still independent of `activeRun`,
  same as today).

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run check`
- New test file passes: `npx vitest run src/app/simulation/_components/server-run-viewer.test.tsx`
- Full suite still passes: `npm test`

#### Manual Verification:

- Start a server run (via "Start on server"), click "View live", and
  confirm the canvas renders boids/predators moving — proving the
  subscription-driven render path works against a real running server
  simulation, not just the mocked test.
- Confirm clicking "Stop viewing" removes the viewer and does NOT stop the
  underlying server run (check via DB, same approach as prior Foundations'
  manual checks) — closing the view must not affect execution.

**Implementation Note**: After automated verification passes, pause for
the manual spot-check above before committing.

---

## Testing Strategy

### Unit Tests:

- `server-run-viewer.test.tsx` (new), following `simulation-canvas.test.tsx`'s
  `vi.mock("~/trpc/react", ...)` pattern to capture
  `api.simulation.watch.useSubscription`'s options object:
  - Calling the captured `onData({ id: "0", data: <fixture LiveRunSnapshot> })`
    results in `drawScene` (spy-wrapped via `vi.mock("./simulation-canvas", ...)`,
    same partial-mock pattern `simulation-canvas.test.tsx` uses for
    `computeSingleRunTick`) being called with that fixture's `boids`/`predators`.
  - Calling the captured `onError({ message: "boom" })` renders a
    `text-destructive` paragraph containing "boom".
  - Clicking "Stop viewing" calls the `onClose` prop exactly once.

### Integration Tests:

- N/A — no real SSE connection is exercised in the automated suite; proven
  manually per Phase 1's Manual Verification.

### Manual Testing Steps:

1. See Phase 1's Manual Verification.

## Performance Considerations

None beyond what F-04 already established (150ms push cadence).

## Migration Notes

None — no schema change.

## References

- Roadmap: `context/foundation/roadmap.md` S-07 (view-running-server-simulation)
- `watch` subscription (F-04): `src/server/api/routers/simulation.ts`
- Rendering logic to export: `src/app/simulation/_components/simulation-canvas.tsx:19-20,113-157`
- Confirmation panel to extend (S-06): `src/app/simulation/page.tsx`
- Component test pattern to follow: `src/app/simulation/_components/simulation-canvas.test.tsx:1-40`
- `TrackedData`/`onData` shape confirmed: `node_modules/@trpc/server/dist/unstable-core-do-not-import-B8epiErP.d.cts:378-402`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: `ServerRunViewer` component + "View live" wiring

#### Automated

- [x] 1.1 Type checking passes: `npm run typecheck` — 1702f03
- [x] 1.2 Linting passes: `npm run check` — 1702f03
- [x] 1.3 New test file passes: `npx vitest run src/app/simulation/_components/server-run-viewer.test.tsx` — 1702f03
- [x] 1.4 Full suite still passes: `npm test` — 1702f03

#### Manual

- [x] 1.5 Canvas renders boids/predators moving for a real running server simulation — 1702f03
- [x] 1.6 "Stop viewing" removes the viewer without stopping the underlying server run — 1702f03
