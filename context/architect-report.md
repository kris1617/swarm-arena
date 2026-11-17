# Module 4 Architectural Report — 10xArchitect

All four artifacts come from one repository: **swarm-arena**, a Next.js
(App Router) + tRPC + Drizzle/SQLite single-user boids/predator-prey
simulation experiment tracker, 731 tracked files, 557 commits, 13 days of
history (2026-11-04 to 2026-11-17) at the time of analysis. No other
repository was used in this module.

## 1. Described projects

| repo | stack | scale | appeared at |
|---|---|---|---|
| swarm-arena | TypeScript, Next.js App Router, tRPC, Drizzle/SQLite, NextAuth | 731 files, 557 commits, single contributor | L2 (map), L3 (feature analysis), L4 (refactor plan), L5 (domain) |

## 2. Project map (L2) — `context/map/repo-map.md`

3 risk zones qualified (criticality × buzz, ≥2 independent signal families):
**sim-engine** (busiest capability — 100 commits/275 changes — and the
repo's one confirmed architectural boundary break, a server-only
simulation file importing a client-presentation color module);
**testing-infra** (actively rising, carrying 2 of the only 7
non-APPROVED review verdicts in the whole project history); **staging-live-view**
(second-busiest, with a real 54%-confidence runtime+co-change coupling to
sim-engine, though its activity has gone quiet since a one-week build-out
spike). Local centers: `src/server/api/routers/simulation.ts` (a genuine
9-partner router hub) and `src/server/db/schema.ts` (Ca 11, instability
0.15, the intended stable foundation). Entry points: Next.js App Router
pages under `src/app/`, with `src/app/simulation/page.tsx` as the primary
user-facing hub. Biggest unknown: the map's own `capabilities.tsv` under-
mapped two real implementation directories (`src/server/auth/*`,
`src/server/feedback/*`), so auth-signin's and feedback-module's true
blast radius is reported as unknown, not confirmed-low.

## 3. Feature analysis (L3) — `context/changes/sim-engine-feature-analysis/research.md`

Analyzed the **server-owned simulation run lifecycle** (start → tick loop →
finish → watch → analysis) — the map's #1 risk zone, chosen specifically
because it already carried a named, unverified boundary-break claim.
**Feature overview**: a tRPC `startServer` mutation inserts a `running` row
and registers an in-memory `LiveRun`; a `setInterval`-driven `tick()` calls
a pure `computeSingleRunTick` core every 16ms, mutating in-memory state;
on completion it computes a 5-factor score and persists `history` to the
DB; a separate `watch` subscription streams live snapshots back to exactly
one viewer. **Technical debt** (3 named, 1 ast-grep-equivalent-verified —
`ast-grep` itself was unavailable in the sandbox, so every structural claim
below was instead confirmed with precise `rg` pattern matches, noted
explicitly as a substitution, not a silent skip): (1) `boids.ts` (server
engine) imports `~/styles/theme-colors` directly — confirmed live and
load-bearing (feeds the persisted score via `computeGeneticDiversity`),
not dead code; (2) `computeSingleRunTick` has exactly two independent,
hand-synced callers with no shared construction helper; (3) the
`history`/score-computation literal is duplicated byte-for-byte at two
completion paths in `server-run-registry.ts`, with the exact "field added,
other copy forgotten" risk already partially materialized — `schema.ts`'s
own comment lists only 3 of the real 8 persisted fields.

## 4. Refactor plan (L4) — `context/archive/.../refactor-opportunities/` (archived, **implemented and merged**)

**Refactored**: the two debt items ranked #1 and #2 by cost-of-debt vs.
cost-of-change — the duplicated `history`/score literal (extracted into one
local `buildFinishPayload` helper) and the `theme-colors` boundary break
(the two seed-color hex constants relocated into a new, server-owned
`src/server/simulation/seed-colors.ts`, with the client-presentation module
re-exporting from it instead of hand-duplicating the values). **Explicitly
not done**: the two hand-synced `computeSingleRunTick` callers (ranked #3,
deliberately excluded — the split is itself an intentional, repeatedly-
endorsed architectural pattern, and `typecheck` already guards its shape,
making it the lowest-marginal-value fix of the three); a third,
newly-discovered duplicate of the `history`/score pattern at
`simulation.ts`'s `stop` mutation (caught by this plan's own plan-review
step, explicitly named in "What We're NOT Doing" rather than silently
left unmentioned). **Phases** (both landed, both test-first-guarded):
1) extract `buildFinishPayload`, guarded by a new characterization test
pinning today's exact persisted output — verified: `npm run typecheck`,
`npm run check`, `npm test` (38/38 files), plus a deliberate-break check
(scoring +1 to the function's result) confirmed the new test actually
catches a regression. 2) relocate the seed-color constants, guarded by a
literal-value characterization test on flock 0's exact seeded color — same
3-gate verification, plus its own deliberate-break check (a single changed
hex digit) confirmed caught. Full-plan impl-review: **APPROVED**, 0
critical/warning findings, 1 cosmetic observation (skipped).

## 5. Domain per DDD (L5) — `context/domain/*.md`

**Ubiquitous language** (5 of 38 distilled terms): *boid/predator/flock/genes*
(the simulated individuals and their inherited traits); *score* (a
deterministic 5-factor product — survival × resource management × genetic
diversity × phase quality × density-vs-area); *population lifecycle phase*
(a 5-valued boom-bust state machine: Establishment→Growth→Overshoot→
Crash→Recovery). **Strongest model-vs-code drift**: the PRD's own
determinism NFR ("two runs with identical seed+params produce identical
scores," `prd.md:60`) is now literally **contradicted** by the already-
shipped `unwatched-run-tick-throttling` feature — a run that was ever
unwatched long enough ticks 3x faster, changing its score even against an
identical-seed twin. Fix side: **docs** (the code already names the
exception via its own `wasEverThrottled` marker; only the PRD text needs
one added clause, citing the already-merged decision).

**Invariant #1 and its aggregate**: not the stale determinism claim itself,
but the *real* invariant the shipped code is actually trying to protect —
"any throttled run's score must be disclosed as non-comparable everywhere
it's surfaced, and that disclosure can never be un-set." Today this is
enforced by 4 independent call sites each hand-checking `wasEverThrottled`
(leaderboard, parameter-suggestion, run-comparison, export), with nothing
stopping a 5th future surface from forgetting the check. A sharper,
flatly-unguarded alternative (R-09, cross-ceiling consistency between the
two object-count caps) was weighed against this pick and explicitly kept
open rather than silently dropped — my call, made via direct question,
was to keep both findings on record rather than switch or bury the
runner-up. **Implemented**: a `ScoredRun` aggregate
(`src/server/simulation/scored-run.ts`, commit `baf3747`) whose single
`disclose()` method is the only public way to read a displayable score,
migrated into all 4 call sites plus their 2 client consumers, full test
suite green. R-09 remains open and unaddressed, as the design always said.

**Anti-Corruption Layer**: checked every real 3rd-party dependency first
(Drizzle, NextAuth, zod, the GitHub feedback client) — all already
correctly isolated; the GitHub client already models the exact pattern
this exercise asks for. The worst *available* leak, found instead: the
bare `{r,g,b}` color representation, independently reconstructed across
**2 layers / 3 call sites** (hex-parsing and per-channel blending in
`boids.ts`, CSS-string construction in `simulation-canvas.tsx`), plus
re-declared 3 more times across the tRPC wire contract, with no Value
Object ever owning the conversions. When asked whether this candidate was
genuinely the strongest available or just the first one found, my call
was to dig deeper before accepting it — a second pass checked `rng.ts`,
recharts, `@libsql/client`, and superjson and confirmed none beat it.
**Implemented, narrower than designed**: a `Color` class
(`src/server/simulation/color.ts`, commit `67df16c`) owning
`fromHex`/`fromHsl`/`toCss`/`toJSON`/`fromJSON`. The design's `blend()`
method was dropped on discovering, during implementation, that
`boids.ts`'s per-channel blend reuses the genetics system's shared
mutation-aware `blendNumber` (rng + mutationChance + mutationMagnitude) —
genetics logic applied to color channels, not a pure color operation this
value object should own.

## 6. Decisions that are mine

Read plainly, most of the initial structural choices in this module —
which risk zone to analyze (sim-engine), which refactor candidates to rank
first — were the agent's own judgment, defended by the artifacts' own
evidence but not individually brought to me as a decision before being
acted on. I did make several real calls on top of that groundwork,
though: implementing **both** top-ranked refactor candidates in one plan
rather than just the highest-ranked one ("go for debts plan"); the initial
go-ahead to run this as a tracked, committed workflow; and, on review of
the two DDD exercises, two decisions the agent explicitly surfaced as
open rather than silently resolved itself — for the invariant exercise, to
**keep both** the comparability finding and the sharper R-09 cross-ceiling
gap on record rather than switch picks or let the runner-up disappear; and
for the ACL exercise, to **dig deeper** before accepting the first
candidate found, which sent the agent back through the rest of the
dependency list and confirmed nothing stronger existed. Both chosen
designs were then actually implemented and verified end-to-end (tests,
typecheck, and a live browser check of the leaderboard/compare pages),
not left as paper plans. What I have *not* done is independently
re-derive the zone/candidate selections from scratch myself — I decided
at the fork points the agent surfaced, rather than generating my own
independent candidate list first.
