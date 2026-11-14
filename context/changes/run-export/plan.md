# Export a run's parameters, score, and history Implementation Plan

## Overview

Let the user export a completed run as JSON (full-fidelity, unflattened) or CSV (parameters + score, one row) from the run's analysis page (`/runs/[runId]`), via a new authenticated download route.

## Current State Analysis

- No export capability exists anywhere in the codebase. No non-tRPC authenticated download route exists yet — the only precedents under `src/app/api/` are `trpc/[trpc]/route.ts` and `auth/[...nextauth]/route.ts` (framework-owned) and `test-auth/login/route.ts` (a plain `NextRequest`/`NextResponse` handler using `env.E2E_TEST_AUTH_SECRET`, not session auth).
- `src/middleware.ts` gates every route except `login`/`api/auth`/`api/test-auth`/static assets behind `auth` — a new route under `src/app/api/` is already login-gated by this middleware; it still needs its own ownership + status check, same as every tRPC procedure in `simulation.ts` does, since middleware only proves *a* session exists, not that this session owns this run.
- `~/server/auth`'s `auth()` export (used by `trpc.ts:29` to build tRPC context) is the session accessor to reuse directly in a Route Handler — no new auth wiring needed.
- `simulationRuns` (schema.ts) already has every field an export needs: all 13 configured parameters, `status`, `score`, `startedAt`, `stoppedAt`, `history` (JSON: `phaseHistory`, `foodRatioSamples`, `survivorGenes`, `populationCountSamples`, `elapsedSeconds` when present). No new persistence.
- `getRunAnalysis` (`simulation.ts:500-552`) is the closest precedent for a single-run, ownership+status-gated read: `FORBIDDEN` if not owned, `BAD_REQUEST` if not `status: "stopped"`. Export reuses this exact gating shape, scoped to completed runs only — consistent with where the export links live (the analysis page, which already requires a stopped run).
- A prior lesson (`context/foundation/lessons.md`): tRPC subscription logic had to be extracted into a plain, framework-free function so it stays testable outside `createCaller`. The same principle applies here in reverse — a Route Handler is also framework glue that's awkward to unit-test directly (needs a `NextRequest`/session mock). The CSV/JSON *formatting* logic should be a plain, exported function the Route Handler calls, not inlined in the handler.

## Desired End State

From a completed run's analysis page (`/runs/[runId]`), the user sees "Export JSON" and "Export CSV" links. Clicking either downloads a file (`run-<id>.json` / `run-<id>.csv`) containing that run's parameters, score, and (JSON only) its full persisted history. A request for another user's run, a non-existent run, or a non-completed run returns an error status instead of a file.

### Key Discoveries

- No new schema or persistence — this is a pure read + reformat of existing columns.
- CSV format deliberately excludes nested history arrays (`phaseHistory`, `survivorGenes`, `foodRatioSamples`, `populationCountSamples`) — a flat one-row-per-run format can't represent them without awkward single-cell serialization; this was the resolved product decision (PRD FR-017), not an implementation shortcut.

## What We're NOT Doing

- No export UI on the dashboard's Running/Saved/Completed rows — the export links live only on the analysis page (`/runs/[runId]`), which already requires a completed run.
- No export for `running` or `saved` runs — same `status: "stopped"` gate `getRunAnalysis` already uses.
- No image/screenshot export format — only JSON and CSV, per the resolved PRD decision.
- No bulk/multi-run export — one run per request, matching the route's `[runId]` shape.
- No changes to `getRunAnalysis`, `getRunsComparison`, or any existing tRPC procedure.

## Implementation Approach

A thin Next.js Route Handler (`src/app/api/runs/[runId]/export/route.ts`) does session/ownership/status gating (mirroring `getRunAnalysis`'s exact gate shape) and then delegates to a new plain, exported formatting function in `src/server/simulation/run-export.ts` that takes the fetched row and a format and returns the file's string body + content type — the testable core, with no `NextRequest`/session types in its signature. Two phases: the route + formatter (backend), then the two links on the analysis page (UI).

## Phase 1: Export route and formatter

### Overview

Add the authenticated download route and the plain CSV/JSON formatting function it delegates to.

### Changes Required:

#### 1. Export formatter

**File**: `src/server/simulation/run-export.ts` (new file)

**Intent**: A plain function that takes a fetched `simulationRuns` row and a format (`"json" | "csv"`) and returns `{ body: string, contentType: string, filename: string }`. JSON mode serializes the full row (all 13 parameters, `score`, `startedAt`, `stoppedAt`, `history`) as-is. CSV mode emits a two-line CSV (header row + one data row) covering the 13 configured parameters plus `score`, `startedAt`, `stoppedAt` — explicitly excluding `history`'s nested arrays, per the resolved product decision. No framework types in this file's signature — it takes plain data in, returns a plain object out, so it's unit-testable without a `NextRequest` or session.

**Contract**:
```ts
export type RunExportRow = {
  id: number; status: string; score: number | null;
  startedAt: Date; stoppedAt: Date | null;
  boidCount: number; separationWeight: number; alignmentWeight: number;
  cohesionWeight: number; maxDurationSeconds: number; predatorCount: number;
  protectionThreshold: number; foodStockInitial: number; foodRegenRate: number;
  flockCount: number; crossbreedingEnabled: boolean; energyThreshold: number;
  mutationChance: number; mutationMagnitude: number;
  history: unknown; // schema-less JSON column, passed through as-is for JSON mode
};

export function buildRunExport(
  run: RunExportRow,
  format: "json" | "csv",
): { body: string; contentType: string; filename: string };
```
CSV header/value ordering: `id,status,score,startedAt,stoppedAt,boidCount,separationWeight,alignmentWeight,cohesionWeight,maxDurationSeconds,predatorCount,protectionThreshold,foodStockInitial,foodRegenRate,flockCount,crossbreedingEnabled,energyThreshold,mutationChance,mutationMagnitude`. Dates serialize as ISO strings in both formats. CSV needs no quoting/escaping logic beyond the default (every value here is a number, boolean, or ISO date string — none contain a comma or quote), so a straightforward `.join(",")` is sufficient; do not pull in a CSV library for this.

#### 2. Export route handler

**File**: `src/app/api/runs/[runId]/export/route.ts` (new file)

**Intent**: `GET` handler reading `runId` from the dynamic segment and `format` from the query string (`?format=json` or `?format=csv`, default `json` if absent/invalid). Checks the session via `auth()` (same accessor `trpc.ts` uses), fetches the run, and gates exactly like `getRunAnalysis`: 404-equivalent if not found, 403 if not owned, 400 if not `status: "stopped"`. On success, calls `buildRunExport` and returns a `Response` with `Content-Type` and `Content-Disposition: attachment; filename="<filename>"` set from the formatter's result.

**Contract**: `export async function GET(request: NextRequest, { params }: { params: Promise<{ runId: string }> })` — Next.js 16 makes dynamic-route `params` a `Promise` (same contract `/runs/[runId]/page.tsx` already has to account for, there via `useParams()` client-side; here server-side via `await params`). Non-numeric `runId` → 400. Missing/invalid `format` → defaults to `json` rather than erroring (a reasonable default, not a validation failure).

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run check`
- New/updated tests pass: `npx vitest run src/server/simulation/run-export.test.ts src/app/api/runs/export.test.ts`
- Full suite still passes: `npm test`

#### Manual Verification:

- (none for this phase — pure backend, covered by automated tests)

---

## Phase 2: Export links on the analysis page

### Overview

Add "Export JSON" / "Export CSV" links to `/runs/[runId]`'s analysis page.

### Changes Required:

#### 1. Export links

**File**: `src/app/runs/[runId]/page.tsx`

**Intent**: Two plain anchor links near the page's existing header (next to the score), pointing at `` /api/runs/${runId}/export?format=json `` and `` /api/runs/${runId}/export?format=csv `` — a direct browser navigation triggers the download via the route's `Content-Disposition` header, no client-side fetch/blob needed. Only rendered when the page's existing data successfully loaded (i.e., inside the same branch that already renders the score/sections, not the loading/error branches) — if the page itself couldn't load the run, there's nothing to export either.

**Contract**: Two `<a>` tags (not Next's `Link`, since this is a same-origin file download, not a client-side route transition — matching how a direct download is conventionally wired; `Link` would still work but an `<a>` is the more honest signal that this leaves the SPA navigation flow for a file response).

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run check`
- Full suite still passes: `npm test`

#### Manual Verification:

- Visiting a completed run's analysis page shows both export links
- Clicking "Export JSON" downloads a `run-<id>.json` file containing the run's parameters, score, and history
- Clicking "Export CSV" downloads a `run-<id>.csv` file with a header row and one data row of parameters + score, no nested history fields
- Requesting `/api/runs/<id>/export` for another user's run returns an error (not a file)
- Requesting `/api/runs/<id>/export` for a still-running run returns an error (not a file)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- `run-export.test.ts`: `buildRunExport` produces correct JSON (full row + history) and correct CSV (header + one row, no history fields) for a sample row; confirms filenames and content types.
- `export.test.ts` (route handler): ownership/status gating matches `getRunAnalysis`'s shape (403 forbidden, 400 not-completed, 400 bad runId); a successful request returns the expected `Content-Disposition` header and body.

### Manual Testing Steps:

1. Complete a real run, open its analysis page, click both export links, inspect the downloaded files' contents.
2. Attempt the export URL for a run that isn't the logged-in user's own — confirm it's rejected.

## Performance Considerations

None — single-row read, no new computation beyond string formatting.

## Migration Notes

None — no schema change; this is a read-only export of existing columns.

## References

- `src/server/api/routers/simulation.ts:500-552` — `getRunAnalysis`, the ownership/status-gate shape this route mirrors.
- `src/app/api/test-auth/login/route.ts` — the only existing plain Route Handler precedent in this codebase (different auth model, but same Next.js Route Handler shape).
- `src/server/auth/index.ts` — `auth()`, the session accessor to reuse.
- `src/middleware.ts` — confirms `/api/runs/*` is already login-gated upstream.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Export route and formatter

#### Automated

- [x] 1.1 Type checking passes: `npm run typecheck` — 8e52df2
- [x] 1.2 Linting passes: `npm run check` — 8e52df2
- [x] 1.3 New/updated tests pass: `npx vitest run src/server/simulation/run-export.test.ts src/app/api/runs/export.test.ts` — 8e52df2
- [x] 1.4 Full suite still passes: `npm test` — 8e52df2

### Phase 2: Export links on the analysis page

#### Automated

- [x] 2.1 Type checking passes: `npm run typecheck`
- [x] 2.2 Linting passes: `npm run check`
- [x] 2.3 Full suite still passes: `npm test`

#### Manual

- [x] 2.4 Visiting a completed run's analysis page shows both export links
- [x] 2.5 Clicking "Export JSON" downloads a `run-<id>.json` file containing the run's parameters, score, and history
- [x] 2.6 Clicking "Export CSV" downloads a `run-<id>.csv` file with a header row and one data row of parameters + score, no nested history fields
- [x] 2.7 Requesting the export route for another user's run returns an error (not a file)
- [x] 2.8 Requesting the export route for a still-running run returns an error (not a file)
