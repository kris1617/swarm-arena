/**
 * Seeded, deterministic PRNG (mulberry32 — public domain), returning
 * floats in [0, 1), the same shape as `Math.random()`.
 *
 * Implemented in-house rather than via a library dependency so the
 * output sequence for a given seed can never change out from under us
 * via an upstream version bump.
 */

// `Rng` is a `() => number` with `getState`/`setState` attached directly to
// the callable — not a separate `{next, getState, setState}` object — so
// every existing call site that calls `rng()` or passes `createRng(seed)`
// anywhere a plain `() => number` is expected (reproducePopulation,
// createInitialPopulation, computeSingleRunTick, and ~39 call sites across
// source and tests) keeps compiling and behaving identically. Only S-04's
// save/resume path needs `getState`/`setState`.
export type Rng = (() => number) & {
	getState: () => number;
	setState: (state: number) => void;
};

export function createRng(seed: number): Rng {
	if (!Number.isInteger(seed)) {
		throw new RangeError(`createRng seed must be an integer, got ${seed}`);
	}
	let state = seed;
	const next = (() => {
		state |= 0;
		state = (state + 0x6d2b79f5) | 0;
		let t = Math.imul(state ^ (state >>> 15), 1 | state);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	}) as Rng;
	// `state` is always a 32-bit integer after the `|= 0`/`| 0` ops above,
	// so `setState` doesn't need the constructor's integer guard — any
	// value `getState` can return is already in range.
	next.getState = () => state;
	next.setState = (newState: number) => {
		state = newState;
	};
	return next;
}
