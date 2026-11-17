---
title: Invariant → guardian aggregate refactor — score comparability
created: 2026-11-17
type: refactor-plan
implemented: 2026-11-17 (baf3747)
---

# Invariant → guardian aggregate: score comparability

**Scope**: planning only — no production code is modified by this document.

**Status: implemented** in commit `baf3747` — `ScoredRun` at
`src/server/simulation/scored-run.ts`, migrated into `listLeaderboard`,
`getParameterSuggestion`, and `getRunsComparison` plus their two client
consumers. `run-export.ts` was deliberately left untouched (see the commit
message): it only passes `wasEverThrottled` through for export with no
disclosure logic duplicated at that site. R-09 (cross-ceiling consistency)
remains open and unaddressed, as this document always said.

## Step 0: Context

Read `context/foundation/prd.md` (Business Logic, Success Criteria, NFRs) and
`context/domain/domain-distillation.md` (this project's own M4L5 artifact 1/3,
produced minutes earlier in this session) as the primary sources. Business
logic lives in two layers, confirmed by both the distillation and direct
reading: `src/server/simulation/*.ts` (pure core — physics, scoring,
per-tick decisions) and `src/server/api/routers/*.ts` (validation,
persistence, authorization). No separate domain/service layer exists.

## Step 1: Identify business invariants (candidates)

From the distillation's own Invariants table (R-01..R-11) plus a fresh read
of the throttling-comparability code:

1. **R-04/D-01 as originally stated**: "two runs with identical seed+params
   produce identical scores" (prd.md:60,218) — **contradicted** by the
   shipped `unwatched-run-tick-throttling` feature (3x `speedMultiplier` for
   unwatched runs changes the tick trajectory, hence the score).
2. **The business's actual, current invariant** (not the stale PRD text, but
   what the shipped code is really trying to guarantee): "any run whose
   score was ever computed from a throttled tick must be disclosed as
   non-comparable, everywhere its score is shown or used statistically, and
   this disclosure can never be un-set once true." This is the *real*
   invariant the `wasEverThrottled` column and its 4 independent call sites
   exist to protect — comparability is the thing actually being guarded,
   not literal determinism (which the business has already, deliberately,
   given up for unwatched runs).
3. Object-count ceilings (R-06a/b, R-07) — enforced with mixed strictness,
   but each already has a single, consistent guard function
   (`checkAgainstAdminRanges`, `checkPerRunObjectCapSoft`) — not spread
   across independent call sites the way comparability is.
4. **Cross-ceiling consistency (R-09)**: no guard anywhere enforces
   `maxConcurrentObjectCount <= maxObjectCount` (or the reverse) — an admin
   can set these two caps into a logically-backwards relative order with no
   warning. Ranked **#2** in `domain-distillation.md`'s own ranking (status
   **ignored**, the only other non-"enforced" invariant besides
   comparability's "contradicted"). A real, sharper, more obviously-visible
   bug than comparability's convention-gap — explicitly weighed against it
   below.
5. Per-user data isolation (R-05) — enforced consistently via one pattern
   (`eq(simulationRuns.userId, userId)`) repeated at every query — spread,
   but *consistently* spread (same guard shape everywhere), not
   independently re-implemented per site the way comparability is.

## Step 2: Classify and select #1

| invariant | (a) how core | (b) how spread | (c) enforcement |
|---|---|---|---|
| Score comparability disclosure (candidate 2) | **Core** — Scoring & Evaluation is the product's named wedge (roadmap.md:35); a silently-miscompared score defeats the entire point of the product | **Very spread** — 4 independent call sites each read `wasEverThrottled` and build their own disclosure (badge text, rationale clause, disclaimer paragraph, CSV column), with no shared accessor | **Declared, not enforced** — nothing stops a 5th call site (or a future refactor of an existing one) from reading `score`/`history` without checking `wasEverThrottled` at all; the write-side guard (`wasEverThrottledWritten`, one-way latch) is solid, but the *read*-side disclosure obligation is pure convention, repeated by hand 4 times |
| Object-count ceilings (candidate 3) | Core-adjacent (Supporting: Parameter Governance) | Spread across 2 layers (start-time hard, live-edit soft) but each layer has exactly one guard function | Enforced (start) / declared (live-edit) — inconsistent strictness, but not silently bypassable per-site |
| **Cross-ceiling consistency (candidate 4, R-09)** | Supporting (Parameter Governance) — gates how many objects can ever run, but not itself the scoring/simulation wedge | **Narrow** — lives in exactly one place (`updateParameterRanges`), there is simply no check there at all; not spread across call sites the way comparability is | **Ignored** — the worst enforcement status on its own axis, with zero code anywhere, not even a convention |
| Data isolation (candidate 5) | Supporting | Spread across every query, but uniformly (same `eq(userId)` shape every time) | Enforced — no per-site drift found |

**Selected: Score comparability disclosure — over the cross-ceiling gap,
explicitly.** The two are a genuine, close call and deserve to be weighed
against each other rather than waved past:

- **Cross-ceiling consistency (R-09)** is arguably the *sharper* bug: it is
  flatly unguarded (zero code, not even convention), the misconfiguration
  is trivially reachable by any admin through the existing settings form,
  and its failure mode (an admin sets `maxConcurrentObjectCount` above
  `maxObjectCount`, silently making the cross-run cap meaningless) is
  concrete and easy to demonstrate. If the goal were "find the single
  easiest-to-exploit unguarded gap," this wins.
- **Score comparability** is chosen instead because the DDD exercise asks
  for the invariant that is simultaneously **most core** and **most weakly
  enforced** — not simply the most exploitable. Cross-ceiling consistency
  sits in the Supporting subdomain (Parameter Governance); comparability
  sits in Core (Scoring & Evaluation is this product's named wedge,
  roadmap.md:35). Comparability's enforcement gap is also the structurally
  more interesting one for an *aggregate* exercise specifically: the bug
  isn't "nobody wrote a check" (R-09's shape, which a single `if` statement
  fixes), it's "four independent places each wrote their *own* copy of the
  same check," which is exactly the shape a guardian aggregate is designed
  to collapse. R-09's fix is a one-line validator, not an aggregate — it
  would make a thin, unsatisfying DDD exercise even though it is a real and
  worth-fixing bug on its own merits (tracked as the domain-distillation
  report's #2 ranked item, independent of this document).

Both are real; this document deliberately picks the one that best
exercises the lesson's aggregate pattern, not the one with the highest
raw severity. R-09 remains open, unaddressed by this plan, and should not
be mistaken for resolved just because a different invariant was chosen here.

## Step 3: Diagnose today's shape

**Write side (solid — not the problem):**
- `server-run-registry.ts:551-572` — `tick()` sets `wasEverThrottledWritten`
  only inside a `.then()` after a successful DB write (the one-way latch,
  hardened during this session's own `refactor-opportunities` impl-review).
  This is the correct, single chokepoint for *writing* the flag.

**Read side (the actual problem — 4 independent, hand-repeated checks):**
1. `simulation.ts:720` — `listLeaderboard` selects `wasEverThrottled` from
   the DB row and passes it straight through; the client
   (`leaderboard/page.tsx`) renders a badge conditioned on it.
2. `simulation.ts:776,795,798` — `getParameterSuggestion` selects it,
   computes `throttledCount = rows.filter((r) => r.wasEverThrottled).length`,
   strips the field, and passes `throttledCount` into
   `suggestParameterChange`, which appends a disclosure clause to
   `rationale` — a *third* independent reimplementation of "check the flag,
   then disclose."
3. `simulation.ts:922,994` — `getRunsComparison`'s success-row type declares
   `wasEverThrottled: boolean` and the push at `:994` copies it from the raw
   row — a *fourth* site, feeding the compare page's own disclaimer
   paragraph (mirroring the pre-existing legacy-row disclaimer pattern).
4. `run-export.ts:29,56` — `RunExportRow` and `CSV_COLUMNS` carry the field
   through to the JSON/CSV export — a *fifth* site in total (the plan above
   says 4, correcting here: write-side latch + 4 independent read-side
   checks = 5 touch points total, 4 of which are read-side disclosure
   duplicates).

**Where the rule is inconsistently enforced**: nowhere does any shared
function or type say "every place that surfaces a run's score MUST also
surface its comparability." Each of the 4 read sites independently
remembered to add the check during its own change (confirmed by this
session's own `impl-review` history — each surface was added in the same
`unwatched-run-tick-throttling` change, by the same careful author/agent
pass, not independently over time by different people — but the *pattern*
that made that possible was "remember to copy this," not "the type system
or a shared accessor won't compile/won't disclose without it"). **No client
is the sole guardian** (all guarding happens server-side, which is good),
but **no error is swallowed either** — the current risk is a silent omission
at a *future* site, not a currently-swallowed error at an existing one.

## Step 4: Design — the guardian aggregate

**Aggregate root: `ScoredRun`** — not a new DB table, a construction-time
wrapper around an already-loaded `simulationRuns` row plus its derived
`breakdown`/`history`, whose entire reason to exist is to make "read a
score without its comparability" a type error, not a convention.

```ts
// src/server/simulation/scored-run.ts (new)

export class ComparabilityNotDisclosedError extends Error {}

export class ScoredRun {
  private constructor(
    readonly runId: number,
    readonly score: number,
    readonly wasEverThrottled: boolean,
  ) {}

  // The ONLY constructor. Takes the exact columns needed, nothing more —
  // callers cannot build a ScoredRun without supplying wasEverThrottled.
  static from(row: { id: number; score: number | null; wasEverThrottled: boolean }): ScoredRun | null {
    if (row.score === null) return null; // unscored rows have no ScoredRun
    return new ScoredRun(row.id, row.score, row.wasEverThrottled);
  }

  // The ONLY way to read a displayable score. Forces the caller to handle
  // the disclosure — there is no `.score` getter that skips it.
  disclose(): { score: number; comparable: boolean; disclaimer: string | null } {
    return {
      score: this.score,
      comparable: !this.wasEverThrottled,
      disclaimer: this.wasEverThrottled
        ? `Run #${this.runId} ticked at an accelerated rate while unwatched — its score may not be directly comparable.`
        : null,
    };
  }
}
```

**Preconditions, not silent defaults**: `ScoredRun.from` returns `null` for
an unscored row rather than fabricating a score — this matches the existing
`getRunsComparison` convention of a `null`-marker row, but makes it the
aggregate's own job, not each caller's. `disclose()` has no parameters and
no way to opt out of the comparability check — there is no `.score` field
exposed directly on the public API, only `disclose()`'s return shape.

**No new transaction/atomicity need**: comparability is derived, read-only
data (it's already persisted as a plain column); the aggregate doesn't
introduce a write path, so no new transaction boundary is needed. The
existing one-way-latch write (Step 3, write side) stays exactly as it is —
this refactor is entirely about the read side.

**Repository**: not a new one. The four call sites already load rows
through Drizzle `.select()` — the change is what they do with the row
*after* loading it (`ScoredRun.from(row).disclose()`), not how they load it.

**Thin API/route**: each of the 4 tRPC procedures changes from "select
`wasEverThrottled`, remember to check it, build disclosure text by hand" to
"select `wasEverThrottled` (still needed in the query), call
`ScoredRun.from(row).disclose()`, use the returned `comparable`/`disclaimer`
fields directly." The enforcement moves from "the author remembered" to
"the TypeScript compiler requires a `ScoredRun` to call `disclose()`, and
`disclose()` is the only public way to get a displayable score."

## Step 5: Before/after, phased plan, tests

### Before/after per site

| site | before | after |
|---|---|---|
| `listLeaderboard` (`simulation.ts:701-742`) | returns raw row incl. `wasEverThrottled`; client checks it itself | returns row with `comparable`/`disclaimer` from `ScoredRun.from(row).disclose()`; client renders the badge from `disclaimer` directly, no client-side boolean logic |
| `getParameterSuggestion` (`simulation.ts:741-803`) | hand-computes `throttledCount`, threads it into `suggestParameterChange` | maps each row through `ScoredRun.from`, filters `!comparable` for the count — same count, same disclosure text, but the "what counts as throttled" logic lives in one place (`ScoredRun`), not re-derived here |
| `getRunsComparison` (`simulation.ts:877-1000`) | success-row type carries raw `wasEverThrottled: boolean` | success-row type carries `disclose()`'s `{ comparable, disclaimer }` shape; compare page renders `disclaimer` directly instead of re-deriving its own sentence |
| `run-export.ts` (`:1-60`) | `RunExportRow.wasEverThrottled: boolean`, raw | `RunExportRow` carries the `disclose()` shape (or at minimum `comparable`+`disclaimer`) so the exported JSON/CSV itself states the caveat in the same words as every other surface, instead of exporting a bare boolean the consumer must interpret |

### Phased plan

1. **Phase 1 (test-first)**: add `scored-run.ts` + `scored-run.test.ts`.
   Test-first because the aggregate's entire value is its *contract*
   (preconditions, no bypass), which a test should pin before any call site
   depends on it. Test cases (legal/illegal):
   - `ScoredRun.from({ score: null, ... })` → `null` (illegal: no score yet).
   - `ScoredRun.from({ score: 0.8, wasEverThrottled: false })` →
     `.disclose()` returns `{ comparable: true, disclaimer: null }`.
   - `ScoredRun.from({ score: 0.8, wasEverThrottled: true })` →
     `.disclose()` returns `{ comparable: false, disclaimer: <non-null string mentioning the run id> }`.
   - There is no public method/getter that returns `score` without going
     through `disclose()` — this is a type-level test (attempting
     `scoredRun.score` directly from outside the class should be a
     TypeScript compile error, since the fields are not exposed publicly in
     the final design — the pseudocode above shows them as `readonly`
     public for brevity; the real implementation should make them
     `private readonly` and expose only `disclose()`).
2. **Phase 2**: migrate `listLeaderboard` to use `ScoredRun`. Smallest,
   single-row call site — lowest risk, proves the pattern end-to-end
   (server + client) before touching the other three.
3. **Phase 3**: migrate `getParameterSuggestion` and `getRunsComparison`
   together (both read multiple rows and aggregate/compare across them —
   similar shape, sensible to pair).
4. **Phase 4**: migrate `run-export.ts`.

Each phase keeps the exact same disclosure wording as today (characterization
tests per this session's own established convention — pin today's rendered
text, then swap the implementation, confirm unchanged) — this is a pure
internal refactor, not a wording change.

### New load-bearing names to register

If this project maintains `docs/reference/contract-surfaces.md` (checked:
the repo-level `CLAUDE.md`/`AGENTS.md` mention this convention as
opt-in/self-bootstrapped — not present in this repo yet), the following new
names would be its first entries: `ScoredRun`, `ScoredRun.from`,
`ScoredRun.disclose()`, `ComparabilityNotDisclosedError`.

## Summary

The selected invariant is not the PRD's literal (now-contradicted)
determinism claim, but the real, currently-shipped invariant it collapsed
into: every surface showing a run's score must disclose comparability, and
that obligation is enforced only by four independent developers/passes
each remembering to check `wasEverThrottled` by hand. A `ScoredRun`
aggregate with a single `disclose()` method, built test-first, makes
"forgot the check" a type error instead of a silent omission — the fifth
future surface that reads a score simply cannot compile without going
through it. The refactor touches read paths only (the write-side one-way
latch is already solid and untouched), needs no new transaction or DB
schema change, and migrates in four small, independently-revertible
phases, cheapest-first. This plan does not implement any of it — that
decision, and its ordering against the other three ranked candidates from
the distillation report, belongs to `/10x-plan`.
