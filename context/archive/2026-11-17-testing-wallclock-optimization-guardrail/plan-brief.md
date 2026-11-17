# Wall-clock-aware optimization guardrail — Plan Brief

> Full plan: `context/changes/testing-wallclock-optimization-guardrail/plan.md`
> Research: `context/changes/testing-wallclock-optimization-guardrail/research.md`

## What & Why

Rollout Phase 10 of `context/foundation/test-plan.md` (Risk #7): a future
"this is faster" claim about the simulation engine can pass the existing
structural big-O/call-count guard while making real wall-clock latency
worse — this already happened once (`spatial-hash-performance-optimization`,
kept anyway) and nothing currently requires a wall-clock check before
merging a similar future change. This change documents a manual-review
Quality Gate closing that process gap, and records the pattern in
`lessons.md`.

## Starting Point

`pipeline-perf.test.ts` (Phase 4's structural guard) measures `Math.hypot`
call-count ratio — a shape proxy, never speed — and its own in-file
comment confirms it stayed in-band through the real incident specifically
because that test's scenario doesn't exercise the regression. Phase 8's
`perf-baseline.json` has exactly 1 historical entry; research quantified
its within-run noise (0.3%–23.5% of mean, averaging 3.8%) as too variable
to support a safe automated regression threshold today.

## Desired End State

`test-plan.md` §5 Quality Gates has a new row requiring both the
structural guard and a wall-clock comparison against the tracked baseline
for any claimed simulation-engine perf change, before merge. `lessons.md`
names the recurring pattern. Rollout Phase 10 is `complete`.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Mechanism | Manual-review checklist only | Matches the non-CI-gating classification and the current 1-data-point noise reality — no automated threshold is safe yet | Research + Plan |
| `--compare` flag | No | Keeps `perf-baseline-report.ts` scoped to run-and-record; manual inspection of the committed artifacts is sufficient for a checklist step | Plan |
| Gate location | `test-plan.md` §5 Quality Gates | One canonical place quality gates already live, consistent with how other gates are tracked | Plan |
| Gate scope | Names both checks explicitly in one row | Matches the plan's own framing ("prove it in both dimensions") — a reader gets the complete picture from one row | Plan |
| Lessons entry | Yes, as part of this phase | This is exactly the recurring-pattern insight `lessons.md` exists for, and it's already fully grounded in research | Plan |

## Scope

**In scope:**
- New Quality Gate row in `test-plan.md` §5
- New `lessons.md` entry on the structural-guard-blindness pattern
- Marking rollout Phase 10 `complete`

**Out of scope:**
- An automated wall-clock regression test (not enough historical data to calibrate a safe threshold)
- A `--compare` flag for `scripts/perf-baseline-report.ts`
- Any change to `pipeline-perf.test.ts` itself
- Reopening the `spatial-hash-performance-optimization` decision

## Architecture / Approach

Pure documentation: one new table row, one new H2 lessons section, one
status-cell flip. No code, no tests.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Quality Gate + lessons entry + closeout | The durable process requirement + recurring-pattern record | None significant — documentation accuracy is the only thing to verify |

**Prerequisites:** None.
**Estimated effort:** Well under 1 session — two file edits and a status flip.

## Open Risks & Assumptions

- This gate relies entirely on human discipline at merge time; nothing
  technically blocks a future engine change that regresses wall-clock
  cost from merging anyway. This is the explicitly accepted tradeoff
  given the current noise data, not an oversight.

## Success Criteria (Summary)

- `test-plan.md` §5 names the wall-clock-comparison requirement
  explicitly, citing the real incident.
- `lessons.md` records the structural-guard-blindness pattern.
- Rollout Phase 10 is `complete` — this test-plan rollout (Phases 1–10)
  is now fully shipped.
