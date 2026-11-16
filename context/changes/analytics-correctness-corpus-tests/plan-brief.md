# Analytics-correctness corpus tests — Plan Brief

> Full plan: `context/changes/analytics-correctness-corpus-tests/plan.md`

## What & Why

Prove `getRunAnalysis`, `getRunsComparison`, and `listLeaderboard` — the procedures roadmap S-35 names — handle the real 20-run parameter-sweep corpus's full range of parameter combinations (including 4 extinction-ended runs) without throwing or returning a malformed shape, by inserting the corpus as real completed DB rows and calling the real procedures end-to-end. Closes this milestone's last open item (M-8).

## Starting Point

Every per-run analytics primitive (genetic diversity, phase classification, cycle segmentation, phase/resource/density quality factors, run-optimization rationale) is already unit-tested, but only against small hand-built synthetic arrays — never the real corpus. `getRunAnalysis`/`getRunsComparison` are thin aggregators calling straight into those primitives; `listLeaderboard` adds one small derived boolean (`scoredWithAreaFactor`) on top of a score-ordered query.

## Desired End State

Three new corpus-driven test files insert the real 20 runs as completed DB rows and prove all three procedures never throw and always return well-formed, plausible-range output — including on the corpus's 4 extinction-ended runs. Two small synthetic cases close two coverage gaps the corpus itself can't reach (a short-tick-count phase-classification branch, an empty diversity-samples case).

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Test target | Insert corpus as real DB rows, call real tRPC procedures | You chose rigor over the cheaper pure-function-only alternative — catches wiring/serialization bugs a pure-function test can't see | Plan |
| Assertion depth | Structural + plausible-range, not exact values | 20 runs × 3 procedures of hand-computed exact expected outputs was disproportionate maintenance cost; matches the roadmap's own "without throwing or malformed shape" framing | Plan |
| Gap-closing cases | Close both (sub-20-tick phase classification, empty diversity samples) now | Cheap, real, currently-uncovered gaps found during this change's own research | Plan |
| getRunsComparison scope | Representative pairs, not all 190 combinations | The breakdown composes primitives Phase 2 already proves correct per-run; only the procedure's own wiring needs proving | Plan |
| listCompleted | Out of scope | Zero computed/derived fields — a pure passthrough; listLeaderboard's near-identical query already covers the real logic | Plan |
| File layout | New dedicated corpus-suffixed files, mirroring S-34 | Consistent, discoverable convention (`*.corpus.test.ts`) | Plan |
| Shared owner | One synthetic owner for all 20 inserted rows | Matches how a real user's own completed runs are scoped; required for listLeaderboard's ordering test | Plan |
| Owner email prefix | `db-fixture-<uuid>@example.com`, not `corpus-*` | Plan-review caught that any `corpus-*` prefix collides with generate-sweep's own `LIKE 'corpus-%@example.com'` cleanup, which runs in the same default test suite | Plan |

## Scope

**In scope:**
- `src/server/api/routers/corpus-db-fixture.ts` — shared DB-insertion helper (+ its own test)
- `simulation.getRunAnalysis.corpus.test.ts`, `simulation.getRunsComparison.corpus.test.ts`, `simulation.listLeaderboard.corpus.test.ts` — the S-35 outcome itself
- Two new cases in existing files (`boids.test.ts`, `page.test.ts`) closing the sub-20-tick and empty-array gaps

**Out of scope:**
- Any change to the analytics functions or procedures themselves
- `listCompleted` (no computed logic to test)
- Exhaustive pairwise `getRunsComparison` coverage
- Regenerating or modifying the committed corpus fixture

## Architecture / Approach

`corpus-db-fixture.ts` loads the corpus via S-34's `loadCorpusFixture()` and inserts all 20 runs as real `simulationRuns` rows under one synthetic owner → each procedure test calls the real tRPC procedure via `createCaller` for that owner → asserts no-throw + well-formed/plausible-range output. Phase 5's two cases are independent, synthetic, and touch only existing test files.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. DB-insertion fixture helper | Shared helper inserting all 20 runs as completed rows + cleanup | None significant — reuses an existing, proven insertion pattern |
| 2. getRunAnalysis corpus test | Proves the primary analytics aggregator against all 20 real runs | None significant — primitives already guard empty-array cases |
| 3. getRunsComparison corpus test | Proves the pairwise comparison procedure against real data | None significant — composes already-proven primitives |
| 4. listLeaderboard corpus test | Proves ordering + the one real derived field | None significant — simple query, real data just exercises it |
| 5. Synthetic gap-closing cases | Closes two pre-existing, corpus-unreachable gaps | None significant — isolated, independent additions |

**Prerequisites:** S-33 (parameter-sweep-corpus-generation) and S-34 (suggestion-quality-corpus-test), both already archived — this change reuses S-34's `loadCorpusFixture()` loader.
**Estimated effort:** Single session, 5 phases, no production code changes.

## Open Risks & Assumptions

- Assertions are structural/plausible-range, not exact-match — a silent logic regression that stays in-range would not be caught by this change. Accepted consciously given the cost of hand-computing exact expected values for 3 procedures × 20 runs.
- `getRunsComparison`'s representative-pairs approach assumes Phase 2 already proves each individual run's primitive-level correctness — if that assumption is ever wrong, Phase 3's narrower coverage wouldn't catch it either.

## Success Criteria (Summary)

- All three named procedures proven to never throw and always return well-formed output against the real 20-run corpus, including its 4 extinction-ended runs.
- Two previously-uncovered code branches (short-tick-count phase classification, empty diversity samples) now have test coverage.
- `npm test`, `npm run typecheck`, and `npm run check` all stay green.
