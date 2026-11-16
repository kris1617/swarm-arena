# Suggestion-quality corpus test — Plan Brief

> Full plan: `context/changes/suggestion-quality-corpus-test/plan.md`

## What & Why

Prove the parameter-suggestion heuristic (`suggestParameterChange`) gives a sensible, correlated suggestion against the real, persisted 20-run parameter-sweep corpus — turning the roadmap's "xcheck if we can get suggestions on parameters" into a repeatable regression check (roadmap S-34). Also closes a real coverage gap found during planning: boolean ranged parameters (e.g. `crossbreedingEnabled`) are now live correlation candidates with zero test coverage anywhere.

## Starting Point

`suggestParameterChange` is a pure, DB-free function already shipped and unit-tested against synthetic rows (`parameter-suggestion.test.ts`). The real 20-row corpus (`context/fixtures/parameter-sweep-corpus/`) is committed but each run's exported record only carries 5 of the 16 params the heuristic needs — the rest must be reconstructed from the sweep's own matrix builder.

## Desired End State

A new test asserts the heuristic returns exactly `parameter: "foodRegenRate"`, `direction: "increase"`, `confidence: "medium"` when run against the real corpus — a measured, deterministic result, not an assumption. A second test proves a boolean parameter can win. A small shared loader exists for S-35 to reuse.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Assertion strictness | Exact top-1 match (parameter/direction/confidence) | The measured corpus result has a ~5x correlation gap between 1st and 2nd place; the originally-discussed "top-3" bound turned out vacuous since only 3 of 16 params ever vary in this corpus | Plan |
| Full-params reconstruction | Re-call `buildSweepMatrix()` and merge in each run's real score | The export's `params` field only carries 5 of 16 fields; the matrix builder is the authoritative, pure source of the other 11 | Plan |
| Boolean-correlation gap | Add a dedicated regression case to the existing synthetic unit test | Research found `crossbreedingEnabled` is now a live, untested correlation candidate (an archived plan-review's "numeric-only" assumption is stale) | Plan |
| Test file location | `src/server/simulation/`, default vitest config | Fast, sync, DB-free test — belongs in the default `npm test` suite like its sibling, not the corpus-specific config | Plan |
| Shared fixture-loader | Extract now, as its own small module | S-35 will need identical gzip-decompression/full-params logic; user chose to share it now despite the light S-35→S-34-output dependency this creates | Plan |
| Rationale assertion depth | Structural fields + substring check, not full string match | Survives a copy/wording tweak to the rationale sentence without losing the signal that matters (which parameter won) | Plan |

## Scope

**In scope:**
- `src/server/simulation/corpus-fixture.ts` — shared loader (+ its own test)
- `src/server/simulation/parameter-suggestion.corpus.test.ts` — the S-34 outcome itself
- One new case in `src/server/simulation/parameter-suggestion.test.ts` — boolean-correlation regression

**Out of scope:**
- Any change to `suggestParameterChange`'s own logic
- Regenerating or modifying the committed corpus fixture
- Building S-35's analytics-correctness tests themselves

## Architecture / Approach

Pure data flow: `loadCorpusFixture()` reads 20 gzip files + re-derives full params via `buildSweepMatrix()` → Phase 2's test maps that into `SuggestionInputRow[]` → calls `suggestParameterChange` → asserts the exact, pre-measured result. Phase 3 is independent — a synthetic case in the existing test file, no corpus involved.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Shared corpus-fixture loader | Reusable loader + its own test | Relative import crossing `src/` → `scripts/corpus/` — unusual direction, documented in the plan |
| 2. Suggestion-quality corpus test | The S-34 outcome: exact-match assertion against real data | None significant — result is pre-measured and deterministic |
| 3. Boolean-correlation regression case | Closes an untested, currently-real gap | None significant — isolated synthetic case |

**Prerequisites:** S-33 (parameter-sweep-corpus-generation), already archived — its fixture is read-only input here.
**Estimated effort:** Single session, 3 small phases, no production code changes.

## Open Risks & Assumptions

- The exact-match assertion (Phase 2) will need updating if `suggestParameterChange`'s logic or thresholds are ever retuned — accepted, since the measured margin makes an accidental flip unlikely.
- The shared loader (Phase 1) creates a light dependency: if S-35 imports `corpus-fixture.ts`, S-35's plan must account for it existing — flagged for whoever plans S-35 next.

## Success Criteria (Summary)

- A test proves the real heuristic, run against the real corpus, picks the parameter that actually drove the score the most.
- A previously-untested code path (boolean params winning) now has coverage.
- `npm test`, `npm run typecheck`, and `npm run check` all stay green.
