# Deterministic Seeded-PRNG Strategy (F-02) Implementation Plan

## Overview

Establish a single, zero-dependency, seeded pseudo-random-number-generator as the one randomness source the simulation will use, so identical parameters + seed reproduce identical outcomes. This is a pure foundation slice — no simulation code exists yet to consume it; this slice only creates the primitive and proves its determinism property.

## Current State Analysis

- No randomness-related code exists for simulation purposes. The only `Math.random()` call in the codebase is `src/server/api/trpc.ts:91`, an artificial dev-mode latency delay in the T3 scaffold's example timing middleware — unrelated to simulation state and out of scope here.
- No PRNG library is installed (`package.json` has no `pure-rand`, `seedrandom`, or similar).
- No `src/server/simulation/` directory exists yet; this slice creates it.
- `context/foundation/tech-stack.md` and the PRD's Non-Functional Requirements establish the determinism requirement: "Two runs started with identical parameters and the same random seed produce identical scores."

### Key Discoveries:

- Nothing in the codebase currently depends on `Math.random()` for anything the simulation will touch — this is a genuinely clean slate, so there's no retrofitting risk, only a convention to establish before S-01's boid-placement logic needs it.

## Desired End State

A `createRng(seed: number): () => number` factory exists at `src/server/simulation/rng.ts`, returning a function that behaves like `Math.random()` (returns floats in `[0, 1)`) but is fully deterministic: calling `createRng(seed)` twice with the same seed and calling `.next()` (the returned function) the same number of times produces identical sequences; different seeds produce different sequences.

**Verification:** `npm run typecheck`, `npm run check`, and `npm run build` pass; `npm test` includes a new passing test proving the repeatability and divergence properties described above.

## What We're NOT Doing

- Not wiring the RNG into any actual simulation logic — no simulation code exists yet (that's S-01's job, which will import this module).
- Not adding distribution helpers beyond uniform `[0, 1)` floats (no `nextInt`, `nextBool`, gaussian, etc.) — YAGNI until a real call site needs one.
- Not adding a PRNG library dependency — the self-contained algorithm avoids that dependency entirely, by design (see Implementation Approach).
- Not touching the existing `Math.random()` call in `src/server/api/trpc.ts:91` — that's an unrelated dev-only latency simulation, not simulation-domain randomness.

## Implementation Approach

Implement `mulberry32`, a small, well-known, publicly-documented deterministic 32-bit PRNG algorithm, directly in `src/server/simulation/rng.ts` — no external package. This guarantees the exact same output sequence for a given seed forever, regardless of any dependency's version history, which directly serves the hard "identical seed → identical score" requirement: a dependency's internal algorithm is something this project doesn't control across future upgrades, while ~15 lines of owned, tested arithmetic is.

The module exports one function, `createRng(seed: number): () => number`, deliberately shaped like `Math.random()` so any future simulation code can drop it in as a replacement with no call-site API to learn.

## Phase 1: RNG module and determinism test

### Overview

Create the RNG module and a test proving the one property this slice exists for: same seed → same sequence, different seed → different sequence.

### Changes Required:

#### 1. RNG module

**File**: `src/server/simulation/rng.ts` (new)

**Intent**: Provide the single seeded-randomness source for all future simulation code.

**Contract**: Export `createRng(seed: number): () => number`. The returned function takes no arguments and returns a float in `[0, 1)` on each call, advancing the generator's internal state each time — matching `Math.random()`'s call signature exactly so it's a drop-in replacement at any future call site.

```typescript
// mulberry32 — public-domain, widely-used deterministic 32-bit PRNG.
// Chosen over a library dependency so the output sequence for a given
// seed can never change out from under us via an upstream version bump.
export function createRng(seed: number): () => number {
	let state = seed;
	return function next() {
		state |= 0;
		state = (state + 0x6d2b79f5) | 0;
		let t = Math.imul(state ^ (state >>> 15), 1 | state);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
```

#### 2. Determinism test

**File**: `src/server/simulation/rng.test.ts` (new)

**Intent**: Prove the determinism property this slice exists to deliver, so a future refactor can't silently break it.

**Contract**: Two Vitest cases — (a) two `createRng(42)` instances each called `next()` the same number of times produce identical arrays of values; (b) `createRng(1)` and `createRng(2)` produce different sequences. No snippet needed — straightforward `describe`/`it` following the existing `post.test.ts` structure in this repo.

### Success Criteria:

#### Automated Verification:

- `npm run typecheck` passes
- `npm run check` passes
- `npm test` passes, including the two new RNG cases
- `npm run build` succeeds

#### Manual Verification:

- None for this phase — the determinism property is fully covered by the automated test; there is no UI or running simulation to eyeball yet

## Testing Strategy

### Unit Tests:

- Same-seed repeatability: two independent `createRng(42)` instances produce identical sequences over N calls.
- Cross-seed divergence: `createRng(1)` and `createRng(2)` produce different sequences (not merely "could differ" — assert actual inequality on at least one value).

### Integration Tests:

- None — no simulation code exists yet to integration-test against.

### Manual Testing Steps:

- None required for this phase.

## Performance Considerations

None — a handful of integer operations per call; this is not a performance-sensitive slice.

## Migration Notes

Not applicable — no existing data or behavior to migrate; this is a new, previously-nonexistent capability.

## References

- Roadmap F-02: `context/foundation/roadmap.md`
- PRD Non-Functional Requirements (determinism): `context/foundation/prd.md`
- Existing test structure to follow: `src/server/api/routers/post.test.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: RNG module and determinism test

#### Automated

- [x] 1.1 npm run typecheck passes
- [x] 1.2 npm run check passes
- [x] 1.3 npm test passes, including the two new RNG cases
- [x] 1.4 npm run build succeeds
