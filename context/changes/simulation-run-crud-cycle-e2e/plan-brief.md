# Plan Brief: Simulation run CRUD cycle E2E

Full plan: `context/changes/simulation-run-crud-cycle-e2e/plan.md`

## What & Why

`simulation-run-delete` added create/read/update/delete for simulation runs but tested start→stop→delete and start→pause separately, never the whole create→pause→delete cycle as one flow. This adds that one test.

## Starting Point

An earlier throwaway manual-verification script for this exact flow failed twice with `savePause` throwing `BAD_REQUEST`. Root cause, now understood: cross-process stale DB rows (leftover "running" rows from an earlier, separate `npx playwright test` invocation, whose webServer process — and in-memory run registry — had already been torn down). A single self-contained test never hits this.

## Key Decision

| Decision | Choice | Why |
|---|---|---|
| Test shape | One self-contained test: start-on-server → save & pause → delete, all within one test/one webServer lifetime | Avoids the exact cross-process stale-state issue that broke the earlier manual script; no production code or registry fix needed |

## Phase

1. **CRUD-cycle E2E test** — one new test in `tests/e2e/authenticated-simulation-run.spec.ts`, verified to pass twice in a row (not just once) given this file's documented history of wall-clock/timing-sensitive flakiness

**Prerequisites**: none. **Estimated effort**: 1 small phase, one test.

## What We're NOT Doing

- Not fixing the underlying stale-registry-row quirk (irrelevant to a self-contained test)
- Not adding an admin-branch E2E variant (already covered by unit tests)
- Not deduplicating against the two existing sibling tests (each proves a distinct path)

## References

- `context/changes/simulation-run-delete/plan.md` — the change this extends
- `context/foundation/lessons.md` — timing-sensitive-assertion flakiness family, same file
