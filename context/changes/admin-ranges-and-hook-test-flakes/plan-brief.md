# Fix two pre-existing flaky tests — Plan Brief

> Full plan: `context/changes/admin-ranges-and-hook-test-flakes/plan.md`
> Research: `context/changes/admin-ranges-and-hook-test-flakes/research.md`

## What & Why

Two pre-existing flaky tests surfaced while running `test-plan-refresh-2026-11-16`'s gates, neither caused by that change. The Stop-hook self-test times out under full-suite CPU/IO contention (not a correctness bug). The admin-ranges test is a confirmed cross-process race on `admin_settings`'s deliberately-global row — already flagged unresolved in `lessons.md` — with no clean in-process fix available.

## Starting Point

`admin_settings` is one global, admin-editable row by confirmed product design (FR-002/FR-018) — not an implementation shortcut, and not something this change may alter. The Stop hook (`.claude/hooks/end-of-turn.sh`) auto-runs a nested test suite at every turn boundary with no coordination against a concurrently-running manual `npm test` — this collision is the most common real-world trigger for the admin-ranges race. A sibling Stop-hook test already has the timeout fix this change applies to two others.

## Desired End State

Both Stop-hook self-tests pass reliably under full-suite load. The Stop hook's own automatic test run detects when a manual `npm test` is already in flight and skips its own nested run instead of racing it for `admin_settings`. The residual risk — two deliberately-concurrent *manual* `npm test` processes can still race — is accepted and documented, not silently assumed fixed.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| Admin-ranges fix approach | Vitest-wide lock file, hook skips when held | Targets the actual confirmed mechanism (Stop-hook auto-run colliding with a manual run) with zero product/schema risk | Plan (user-confirmed, after reconsidering an initially-chosen architectural option that would have violated FR-002/FR-018) |
| Hook-test fix scope | Bump both under-timed tests, not just the reported one | Same root cause, same trivial fix; the sibling would eventually flake the same way | Plan (user-confirmed) |
| Verification for the lock | One-off deliberate concurrent-process check, not a new automated test | Proves the lock's real effect without baking "concurrent npm test processes" into a repeatable technique, which lessons.md already warns against | Plan (user-confirmed) |

## Scope

**In scope:** timeout fix for 2 Stop-hook self-tests; a vitest-wide lock file (`globalSetup`/`globalTeardown`) with stale-PID safety; `end-of-turn.sh` checking that lock before its own nested test run; a `lessons.md` entry documenting the residual risk.

**Out of scope:** changing `admin_settings`'s schema/architecture (confirmed product requirement); fully eliminating the race (only reducing its most common trigger); any new automated test asserting the lock's behavior.

## Architecture / Approach

Vitest's `globalSetup`/`globalTeardown` run once per top-level `vitest` invocation regardless of which project(s) it includes — exactly the granularity needed for a lock held for the life of any test run. `end-of-turn.sh` checks that lock (with a liveness check on the recorded PID, so a crashed process can't wedge future runs) before its own nested `vitest run` and skips with an informational note if another process already holds it.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Bump Stop-hook self-test timeouts | 2 tests get the existing sibling's `15_000` timeout | None — fully settled, trivial |
| 2. Vitest-wide lock file + hook-side skip | globalSetup/globalTeardown lock + hook check | Stale-lock handling must not wedge the hook if a prior process crashed |
| 3. Deliberate concurrent-process verification + lessons.md note | Proves the lock works under real concurrency; documents residual risk | None — verification-only |

**Prerequisites:** None.
**Estimated effort:** 3 phases; Phase 1 is trivial, Phase 2 is the real work, Phase 3 is verification/documentation only.

## Open Risks & Assumptions

- Assumes a PID-liveness check (`kill -0`) is sufficient to detect a stale lock on this project's target platforms — if the project ever needs to run cross-platform (e.g. Windows without WSL), this check would need a different mechanism.
- Two manually-run concurrent `npm test` processes can still race (accepted, not a defect in this fix).

## Success Criteria (Summary)

- `npm test` passes reliably (2+ consecutive runs) including both previously-flaky tests.
- A deliberate concurrent-process check confirms the lock causes a detectable skip.
- `lessons.md` records the residual risk so it isn't rediscovered as a surprise.
