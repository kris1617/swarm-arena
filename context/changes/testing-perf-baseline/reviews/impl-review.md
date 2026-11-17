<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Reproducible performance baseline

- **Plan**: context/changes/testing-perf-baseline/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3
- **Date**: 2026-11-17
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 3 observations (all 3 fixed during triage)

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Summary

All 3 phases implemented exactly as planned, no drift. The implementation correctly resolved the plan's own open question about `tinybench`'s `time`/`iterations` semantics (verified `time: 0`, not the plan's tentative `Number.POSITIVE_INFINITY`, against the installed package's real README/`.d.ts` — the plan explicitly asked for this confirmation). The `tsx` devDependency and the file split into `perf-baseline.ts` (measurement) / `perf-baseline-report.ts` (output-writing) were both anticipated by the plan's own text, not scope creep. The append-only JSON invariant and the markdown section-replace logic (the two correctness-critical pieces of this change) were both verified directly against the real `capacity-limits.md` file content and confirmed sound. The real benchmark run executed cleanly: 1 entry, 54 rows, both known directional facts (cost ↑ with object count; cost ↓ at larger area for fixed count) hold in the committed data.

## Findings

### F1 — Concurrent-run race on perf-baseline.json (no lock)

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: scripts/perf-baseline-report.ts:80-88
- **Detail**: `appendJsonResults` does read-then-write with no file lock. Two concurrent `npm run perf:baseline` invocations could race, and one run's entry could be lost (last-writer-wins on the full-array rewrite) — though the file is never left in a corrupted/invalid JSON state either way.
- **Fix**: Applied — `appendJsonResults` now writes to a `${jsonPath}.tmp-${pid}` temp file and `rename`s it into place, rather than writing `jsonPath` directly. This makes the write itself atomic on POSIX (a killed process can never leave `perf-baseline.json` truncated/corrupt) without adding external locking. Does not eliminate the read-then-write lost-update window between two fully concurrent invocations — that residual risk remains accepted per the plan's single-process-precondition discipline.
- **Decision**: FIXED (Fix differently — atomic write + merge) — `scripts/perf-baseline-report.ts`, verified via `npx tsc --noEmit`, `npm run check`, and a smoke test (two sequential `appendJsonResults` calls against a scratch path, confirmed both entries present, no corruption, no stray temp file left behind).

### F2 — Cosmetic double-blank-line edge case in markdown append path

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: scripts/perf-baseline-report.ts:140-142
- **Detail**: The "append new section" branch's separator logic (`!existing.endsWith("\n\n") ? "\n\n" : ""`) can produce an extra blank line if the file already ends in exactly one `\n`. Not reachable in the current file's actual state (the section already exists, so the replace branch runs instead), purely cosmetic if it ever triggers.
- **Fix**: Applied — `updateMarkdownSummary`'s append-new-section branch now trims all trailing newlines before re-adding exactly one blank line (`existing.replace(/\n+$/, "")` + conditional `"\n\n"`), rather than conditionally adding a separator based on whether `existing` already ends in `"\n\n"`.
- **Decision**: FIXED — `scripts/perf-baseline-report.ts`, verified via `npx tsc --noEmit`, `npm run check`, and a smoke test (scratch markdown file ending in a single `\n`, confirmed output has exactly one blank line before the new section, no double blank line).

### F3 — Relative imports instead of `~/*` alias

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: scripts/perf-baseline.ts, scripts/perf-baseline-report.ts
- **Detail**: Both new scripts use relative imports (`../src/server/simulation/...`) instead of this project's `~/*` tsconfig alias convention. Documented in-file: these scripts run outside `src/` via a bare `tsx`/Node invocation, which isn't guaranteed to honor the alias resolution Vitest's own config applies for `scripts/corpus/*.ts`.
- **Fix**: Applied — confirmed `tsx` resolves the `~/*` alias correctly (smoke-tested from both `/tmp` and `scripts/` directly), switched `scripts/perf-baseline.ts`'s imports from `../src/server/simulation/...` to `~/server/simulation/...`. `scripts/perf-baseline-report.ts` only imports its sibling file (`./perf-baseline`), which has no alias to apply — unchanged.
- **Decision**: FIXED — `scripts/perf-baseline.ts`, verified via `npx tsc --noEmit`, `npm run check`, and a smoke test running `runBenchmarkGrid` end-to-end on a 1-config trial grid via `tsx` (output: plausible, consistent with the real baseline run's data at the same config).
