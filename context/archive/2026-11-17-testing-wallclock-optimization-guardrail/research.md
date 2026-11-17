---
change_id: testing-wallclock-optimization-guardrail
topic: "Rollout Phase 10 grounding — wall-clock-aware optimization guardrail (Risk #7)"
researcher: Claude Sonnet 5
date: 2026-11-17
status: complete
---

# Research: Wall-clock-aware optimization guardrail (rollout Phase 10, Risk #7)

## Question

Risk #7 (`context/foundation/test-plan.md` §2): "A future performance
'optimization' passes the existing structural big-O/call-count guard
(Risk #3) while making real wall-clock latency worse for this project's
actual radius/world-size ratios — this already happened once and was
kept anyway." Ground the real failure path, verify the response
guidance, and identify the cheapest mechanism that could prove
protection without being flaky.

## Summary

The incident Risk #7 describes is real and fully documented in
`archive/2026-11-15-spatial-hash-performance-optimization/plan.md`: the
spatial-hash optimization made `stepBoids`' boid-boid loop measurably
**slower** in wall-clock terms (confirmed by the plan's own Overview),
while `pipeline-perf.test.ts` — the exact structural guard Risk #7
references as "Risk #3's guard" — continued to pass, because it measures
`Math.hypot` call-count ratio, not time. The guard and the incident are
correctly linked; no anchor correction is needed here.

The response guidance's core assumption — that a repeatable, automated
"compare against the baseline, fail if worse" assertion is straightforwardly
buildable — does **not** fully hold given the current state of
`perf-baseline.json`: only **one** committed entry exists (54 rows, from
Phase 8's single real run), so there is no cross-run history yet to
calibrate a safe regression threshold against. The only noise
quantification available today is **within-run** sample variance (N=8
tinybench samples per config in that one run), which itself ranges from
0.3% to 23.5% of each config's mean, averaging 3.8% — and that range is
itself evidence that a single automated threshold applied uniformly
across the whole 54-config grid would either be too loose to catch a
real regression at the quietest configs, or too flaky at the noisiest
ones. `test-plan.md`'s own classification of this benchmark as
`benchmark (non-CI-gating)` already anticipates exactly this kind of
noise.

## Detailed findings

### 1. The existing structural guard (confirmed, not a new discovery)

`src/server/simulation/pipeline-perf.test.ts`'s single test,
`"grows Math.hypot call count quadratically, not cubically or
unboundedly, as boid/predator count scales 4x at a fixed 4:1 ratio"`,
asserts `ratio` (call-count at 4x population scale-up) is in `(10, 22)`
— a structural, call-count-based proxy for algorithmic complexity,
explicitly chosen (per the test's own comment) because "timing
wall-clock... would be flaky." This test is the literal Phase 4
(`testing-render-perf-budget`, archived
`context/archive/2026-11-12-testing-render-perf-budget/`) deliverable
Risk #7 refers to as "the existing structural big-O/call-count guard" —
confirmed by reading that archived plan, which names
`pipeline-perf.test.ts` as its Phase 1 output. The guard measures
*shape* (does growth stay sub-cubic), never absolute speed.

### 2. The confirmed incident this guard missed

`archive/2026-11-15-spatial-hash-performance-optimization/plan.md`'s
Overview states directly: at this project's actual constants, the
grid-optimization was "measurably **slower**" for `stepBoids`' own
boid-boid loop, because `NEIGHBOR_RADIUS=70` already covers roughly 18%
of the world's volume — a grid can't narrow a candidate set that's
already most of the population, and pays cell-lookup/sort overhead on
top of a scan that's barely smaller. The team's own decision (documented
in that plan) was to keep the change anyway, trading this one function's
wall-clock regression for implementation consistency across every
neighbor query. The structural guard (`pipeline-perf.test.ts`) passed
throughout — its own comment confirms the post-optimization ratio
(~15.8) stays "comfortably inside [10, 22]" specifically because this
test's scenario (dense, small-world population) is one where the grid
narrows nothing, meaning the call-count metric was blind to the very
regression that happened. This is exactly the gap Risk #7 names, grounded
in real, already-shipped code history rather than a hypothetical.

### 3. `perf-baseline.json`'s actual historical depth

Confirmed via direct inspection: `context/foundation/perf-baseline.json`
(as of this research, at the single entry committed in
`context/archive/2026-11-17-testing-perf-baseline/`) contains **exactly
one** entry, with `results` holding all 54 grid rows from that one real
run (`npm run perf:baseline`, commit `8d1c3d...`, 2026-11-17). There is
no second run yet, so there is no actual cross-run (day-to-day,
machine-load-dependent) variance data — only the within-run,
N=8-samples-per-config variance `scripts/perf-baseline.ts` itself
reports (`stdDevMs` per row).

### 4. Quantified within-run noise (the only noise data that exists today)

Computed directly from the one committed entry's 54 rows
(`stdDevMs / meanMs × 100`): the noisiest configs are the
**small-object-count, short-duration** ones — `100 objects / area 400 /
4 concurrent runs`: 23.5% of mean; `100 objects / area 200 / 1 run`:
15.3%; `400 objects / area 1000 / 4 runs`: 12.2%. The quietest configs
are the **large-object-count, long-duration** ones — `1000 objects / area
200`, both `1` and `2` concurrent-run variants: 0.7%; `400 objects / area
1000 / 1 run`: 0.3%; `1000 objects / area 1000 / 4 runs`: 0.3%. The
grid-wide average is 3.8% of mean, but the spread (0.3%–23.5%) means a
single uniform regression threshold cannot be both tight enough to catch
a real regression at the quiet end and loose enough to avoid false
positives at the noisy end. This is within-run noise only — real
cross-run noise (a different day, a differently-loaded machine) could be
larger still, and there is currently no data to bound it, since only one
run has ever been committed.

### 5. Feasibility of an automated comparison mechanism

**Technically buildable, but not safely automatable as a hard-fail gate
across the whole grid today.** A script could read the last two entries
from `perf-baseline.json`, diff each config's `meanMs`, and flag/report
deltas — this is a small, mechanical addition `scripts/perf-baseline-report.ts`
does not currently have (no `--compare` flag exists; confirmed by
reading that file in full). The open design question for `/10x-plan` is
**what the mechanism does with that comparison**, not whether it can be
computed:

- A **hard automated fail** (`exit 1` if any config regresses past a
  fixed threshold) would need a per-config-sensitive threshold (given
  the 0.3%–23.5% noise spread above) and at least one more real
  historical run to validate that threshold doesn't already false-fail
  on pure noise — neither exists yet.
- A **documented manual-review checklist step** (requiring the author of
  a claimed simulation-engine performance change to run
  `npm run perf:baseline`, or a narrower subset, and compare against the
  last committed entry before merging) matches `test-plan.md`'s own
  existing `benchmark (non-CI-gating)` classification for this whole
  benchmark family, and sidesteps the threshold-calibration problem
  entirely by keeping a human in the loop for a judgment call the data
  doesn't yet support automating.
- A **narrow automated sanity check** limited to only the quietest,
  most-stable configs (e.g., the `1000`-object single-run configs,
  <1% noise) could be a legitimate middle ground — automatable today
  without waiting for more historical runs — but would only catch a
  regression large enough to show up at that specific population/area
  combination, not a regression isolated to a different region of the
  grid (as the real incident was, isolated to `stepBoids`' boid-boid
  loop specifically).

No existing precedent in this repo for a `--compare` flag or any
automated perf-regression gate; `scripts/perf-baseline-report.ts`'s
current scope is strictly "run and record," never "run and judge."

## Response guidance — verified / corrected

- **"Require proof in both dimensions"** — confirmed the two guards
  (structural: `pipeline-perf.test.ts`; wall-clock: Phase 8's
  `perf-baseline.json`/`npm run perf:baseline`) are real, independent,
  and the first one's own history (§2 above) proves it cannot catch what
  the second one would.
- **"Challenge whether an automated comparison is sufficient"** —
  confirmed insufficient *today*, specifically because of §3/§4: only
  one historical run exists, and that run's own within-run noise spread
  (0.3%–23.5%) rules out a single safe uniform threshold without more
  data or a narrower automated scope.
- **"Avoid a flaky automated assert"** — confirmed this anti-pattern is
  real and grounded in this project's own committed data, not a
  generic caution.
- **"Ground this in test-plan.md's non-CI-gating classification"** —
  confirmed: Phase 8's own row in §3 and its cookbook entry (§6.8)
  already classify this benchmark family as
  `benchmark (non-CI-gating)`, consistent with a manual-review-gate
  response rather than a new automated hard-fail test.

## Open items for `/10x-plan`

- Decide the actual mechanism: a documented manual-review checklist item
  (likely the cheapest, safest given the current one-data-point state),
  a narrow automated sanity check on the quietest configs only, or a
  combination — this is a genuine product/process decision research
  cannot settle, since it depends on how much false-positive risk the
  team is willing to accept versus how much manual discipline to rely on.
- Decide whether `scripts/perf-baseline-report.ts` should gain a
  `--compare` flag (diff against the last committed entry, report-only,
  no exit-code gating) as part of this phase, purely as a developer aid
  for the manual-review step, independent of whether anything becomes
  automated/CI-gating.
- Decide where the guardrail should live: a new `src/server/simulation/*.test.ts`
  unit test (if a narrow automated check is chosen), a
  `context/foundation/test-plan.md` §4 Quality Gates entry (if a
  manual-review checklist item), or both.
