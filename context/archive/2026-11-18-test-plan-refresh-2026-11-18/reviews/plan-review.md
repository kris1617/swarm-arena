<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Page-level smoke & regression sweep

- **Plan**: context/changes/test-plan-refresh-2026-11-18/plan.md
- **Mode**: Deep
- **Date**: 2026-11-18
- **Verdict**: REVISE (triaged — all 3 findings FIXED → SOUND)
- **Findings**: 0 critical, 3 warnings, 0 observations — all FIXED

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | WARNING |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | WARNING |

## Grounding
6/6 paths ✓, 3/3 symbols ✓, brief↔plan ✓. `docs/reference/contract-surfaces.md` absent — skipped.

## Findings

### F1 — Route count is wrong throughout (13/11 stated, actual 14/12)

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness / End-State Alignment
- **Location**: Overview, Current State Analysis, Desired End State, Phase 2 title/overview; plan-brief.md's What & Why / Key Decisions / Desired End State
- **Detail**: The plan states "13 real routes" and Phase 2 says "11 auth-only routes," but the actual enumerated list in Current State Analysis has 14 entries (`/`, `/dashboard`, `/simulation`, `/simulation/kitchen-sink`, `/runs/compare`, `/runs/[runId]`, `/leaderboard`, `/reference` + 4 subpages, `/admin/settings`, `/admin/elevation`), and Phase 2's own Contract lists 12 route names, not 11. The literal route lists used by each phase are correct — only the stated counts are wrong — so an implementer following the explicit lists would still cover everything, but the miscounted labels would propagate into `test-plan.md`'s Phase 4 update and mislead future readers about coverage.
- **Fix**: Correct "13" → "14" and "11" → "12" everywhere both numbers appear in `plan.md` and `plan-brief.md`.
- **Decision**: FIXED

### F2 — "No tsconfig alias in Playwright" claim is factually wrong

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Current State Analysis; "Critical Implementation Details"; Phase 1 Contract
- **Detail**: Verified empirically (a throwaway spec importing `~/env` passed under `npx playwright test`) — Playwright's bundled `tsconfig-loader` already reads `tsconfig.json`'s `paths` and resolves `~/*` natively, no `tsconfig-paths` package needed. The plan's claim that a relative import "will resolve correctly, unlike the alias" is wrong; both resolve to the identical file with no behavioral difference. The "Critical Implementation Details" section exists only to justify this false constraint.
- **Fix**: Remove the false claim from Current State Analysis and the entire "Critical Implementation Details" section; let Phase 1's fixture use the normal `~/server/db` / `~/server/db/schema` alias like the rest of the codebase.
- **Decision**: FIXED

### F3 — Shared-DB-file busy-timeout safety is incidental, not documented

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1, admin fixture
- **Detail**: Confirmed the Playwright test process, the app's `webServer`, and any parallel `npm test` vitest run all point at the same `db.sqlite` file. `src/server/db/index.ts`'s `busy_timeout` pragma is per-connection, not per-file, so a fixture that opened its own raw `createClient(...)` would start with SQLite's default no-retry busy handler and risk `SQLITE_BUSY` under concurrent writes. The plan's fixture is safe only because it imports the shared `db` module (which sets the pragma on first import in that process) rather than opening a new client — but the plan never says this is *why* it's safe, so a future edit that swaps to a raw client would silently reintroduce the risk.
- **Fix**: Add one sentence to Phase 1's Contract: "Must import the existing `db` singleton from `~/server/db` (not a new `createClient(...)` call) — this is what gives the fixture's connection the project's `busy_timeout` pragma for free; a raw client would start with SQLite's default no-retry busy handler against the same file the app server and any parallel `npm test` run are writing to."
- **Decision**: FIXED
