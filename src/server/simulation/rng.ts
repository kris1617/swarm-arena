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
