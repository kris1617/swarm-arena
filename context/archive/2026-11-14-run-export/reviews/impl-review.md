<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Export a run's parameters, score, and history Implementation Plan

- **Plan**: context/changes/run-export/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2
- **Date**: 2026-11-14
- **Verdict**: APPROVED
- **Findings**: 0 critical, 2 warnings (both fixed), 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS (after fix) |
| Architecture | PASS |
| Pattern Consistency | PASS (after fix) |
| Success Criteria | PASS |

## Findings

### F1 — JSON export leaked fields outside `RunExportRow`'s named contract

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `src/server/simulation/run-export.ts` (`buildRunExport`'s JSON branch)
- **Detail**: `const jsonBody = { ...run, ... }` spread the entire object the caller passed in, not just `RunExportRow`'s named fields. `RunExportRow`'s type only restricts what TypeScript checks at the call site — it doesn't strip properties at runtime. The route handler passes the full Drizzle row (`db.query.simulationRuns.findFirst`), which also has `userId`, `seed`, and `savedState` (`schema.ts:92-137`). So every JSON export leaked: `userId` (the owner's own internal id — low risk since it's their own data, but unintentional and unnamed in the plan's Contract), `seed` (a configured value the CSV branch deliberately excludes, creating a JSON/CSV scope inconsistency), and `savedState` (currently always `null` since the route gates on `status: "stopped"`, but nothing in `buildRunExport` itself enforces that invariant — a future gate change could leak a full live-state snapshot). Both parallel review subagents independently flagged this (one as CRITICAL, one as WARNING); rated WARNING here since the actual exposure today is the user's own data to themselves, not a cross-user leak — but it's a real, unintentional contract violation worth fixing regardless of today's blast radius.
- **Fix**: Build an explicit allow-listed object for the JSON branch too, mirroring the CSV branch's `CSV_COLUMNS` iteration, instead of spreading `run`.
- **Decision**: FIXED — guard added; new test "excludes fields outside RunExportRow from JSON mode, even if present on the input object" added and passing. Deliberate break-check confirmed: reverting to the spread made the test fail exactly as predicted (`userId` leaked); restored before committing.

### F2 — Export links used raw `<a>` tags instead of this codebase's established link component

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `src/app/runs/[runId]/page.tsx`
- **Detail**: Every other interactive link in this codebase (`dashboard/page.tsx`, `simulation/page.tsx`, etc.) uses `next/link`'s `Link`, styled with this app's existing token classes. The two new export links were the only raw `<a>` tags in `src/app`. Not a design-token violation (no literal colors), but a stylistic/component-reuse inconsistency — the plan's own Contract reasoning for choosing `<a>` over `Link` ("a direct download, not a client-side route transition") doesn't actually require a bare `<a>`; `Link` renders a real `<a>` under the hood and works identically for this case.
- **Fix**: Switched both to `next/link`'s `Link`, styled to match the dashboard's existing row-action button convention (`bg-input text-foreground hover:bg-foreground/15 rounded-full px-4 py-1 font-semibold`).
- **Decision**: FIXED — no test coverage needed (pure styling/component swap, already covered by this phase's manual verification).

### F3 — `csvValue`'s null handling (`"null"` literal string)

- **Severity**: 👁️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: `src/server/simulation/run-export.ts` (`csvValue`)
- **Detail**: `String(null)` → the literal text `"null"` in a CSV cell for a nullable `score`/`stoppedAt`. This is a deliberate, tested choice (not a bug), but an empty cell is the more typical CSV convention for a null value and could read oddly in a spreadsheet.
- **Fix**: None needed for this change — no action required; worth a one-line product note if CSV exports become a more prominent deliverable later.
- **Decision**: SKIPPED (intentional, tested choice; not worth changing now)

### F4 — No test for a garbage `format` query value (behavior was already correct)

- **Severity**: 👁️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: `src/app/api/runs/[runId]/export/route.ts`
- **Detail**: `?format=xml` (or any value other than exactly `"csv"`) already fell back to JSON gracefully, no crash — correct defensive behavior, just untested.
- **Fix**: Added a test ("defaults to JSON for a garbage format value instead of erroring") locking in the fallback behavior.
- **Decision**: FIXED — test added and passing.

### F5 — Side-fix (`busy_timeout` pragma) safety

- **Severity**: 👁️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/server/db/index.ts`
- **Detail**: Confirmed safe: `isNewClient` is computed before the client is created/cached, so the pragma runs exactly once per actual new `Client` instance (the cached dev/test singleton skips it on subsequent module reimports). No race — Node's ESM loader resolves concurrent imports of the same module to the same in-flight promise. The pragma call blocks module evaluation briefly, but it's a local SQLite pragma — effectively instant, not a practical hang vector.
- **Fix**: None needed — no action required.
- **Decision**: SKIPPED (confirmed safe as written)

## Not flagged as findings (reviewed, found adequate)

- CSV column order exactly matches the plan's Contract (`id,status,score,startedAt,stoppedAt,boidCount,...`), confirmed against both the code and its tests.
- The export route's gating order and status codes (400 bad-runId, 401 unauthenticated, 400 not-found, 403 forbidden, 400 not-completed) mirror `getRunAnalysis`'s established shape exactly.
- All "What We're NOT Doing" constraints held: no dashboard export UI, no export for running/saved runs, no image format, no bulk export, `getRunAnalysis`/`getRunsComparison` unchanged.
- The side-fix (`busy_timeout` pragma) is properly documented as a side-fix in its commit message and recorded as a `lessons.md` entry, per this project's own established convention — not silently bundled.
- `vi.mock("~/server/auth", ...)` in the route handler's test is the first `vi.mock` call in this repo; reviewed and found idiomatic, not fragile — no existing convention it diverges from.
- Automated success criteria: `npm run typecheck`, `npm run check`, `npm test` (196/196) all pass as of this review, including both fixes and their new tests.
