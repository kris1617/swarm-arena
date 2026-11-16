<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Fix two pre-existing flaky tests

- **Plan**: context/changes/admin-ranges-and-hook-test-flakes/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3
- **Date**: 2026-11-17
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — PID-reuse edge case not documented as an acknowledged risk

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `.claude/hooks/end-of-turn.sh:70`, `vitest.global-setup.ts`
- **Detail**: The lock liveness check (`kill -0 "$LOCK_PID"`) distinguishes only "dead" from "alive." If a crashed vitest process leaves a stale lock and the OS later reassigns that same PID to an unrelated process before the hook's next check, the hook would wrongly treat it as "another vitest is running" and skip its own tests — potentially repeatedly, until that unrelated process also exits. Neither `plan.md`'s "Critical Implementation Details" nor the new `lessons.md` entry names this exact failure mode; both describe only "dead vs. alive" and "two genuinely concurrent vitest processes," not "alive but the wrong process." Practical severity is low (narrow timing window, local single-user dev tooling, worst case is a skipped test run with a visible `systemMessage`, never silent corruption) — but documentation currently doesn't claim to cover this gap, so it would overstate accuracy to call it already acknowledged.
- **Fix**: Add a one-line note to the `lessons.md` entry (or `plan.md`) naming PID-reuse as an additional narrow, accepted edge case. No code change needed given the low practical severity on a local, single-user dev box.
- **Decision**: FIXED — added to lessons.md's existing entry.

## Notes

Both review agents independently confirmed zero drift across all 4 changed files — the timeout bumps, the new `globalSetup`/`teardown` lock mechanism (correctly adapted to Vitest 5.1.0's actual single-key API, verified against the installed package rather than assumed), and the hook-side skip logic all match the plan's final intent exactly, including that the pre-existing Biome/tsc/REPORT-driven exit-2 behavior is completely preserved. The scope boundary was respected: no file touches `admin_settings`' schema or any production consumer, confirmed via `git show --stat` across the full commit range — the architectural option considered and rejected during planning (per `research.md`'s Open Questions) was correctly not implemented.

The safety reviewer also confirmed two already-acknowledged residual gaps are correctly scoped by existing documentation: two genuinely-simultaneous `setup()` calls silently overwriting each other's PID (covered by `lessons.md`'s "two manually-concurrent runs can still race" note), and `kill -0`'s EPERM-vs-ESRCH ambiguity (theoretical in this single-user local-tooling context, not exploitable in practice). Only the PID-reuse case (F1) falls outside what's currently written down.
