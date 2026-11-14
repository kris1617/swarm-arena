import { describe, expect, it } from "vitest";

import { createRng } from "~/server/simulation/rng";

describe("createRng", () => {
	it("produces an identical sequence for the same seed", () => {
		const a = createRng(42);
		const b = createRng(42);

		const sequenceA = Array.from({ length: 10 }, () => a());
		const sequenceB = Array.from({ length: 10 }, () => b());

		expect(sequenceA).toEqual(sequenceB);
	});

	it("produces a different sequence for a different seed", () => {
		const a = createRng(1);
		const b = createRng(2);

		const sequenceA = Array.from({ length: 10 }, () => a());
		const sequenceB = Array.from({ length: 10 }, () => b());

		expect(sequenceA).not.toEqual(sequenceB);
	});

	it("rejects a non-integer seed", () => {
		expect(() => createRng(Number.NaN)).toThrow(RangeError);
		expect(() => createRng(1.5)).toThrow(RangeError);
	});

	it("is still callable as a plain () => number everywhere it was before", () => {
		const rng = createRng(1);
		const value: number = rng();
		expect(typeof value).toBe("number");
	});

	it("getState/setState round-trips to the exact continuing sequence", () => {
		const live = createRng(7);
		// Advance partway through a sequence.
		for (let i = 0; i < 5; i++) {
			live();
		}
		const capturedState = live.getState();
		const continuedFromLive = Array.from({ length: 5 }, () => live());

		// A fresh rng, replayed to the same point via setState, must produce
		// the identical continuation — not just "a" sequence, but the exact
		// one the live rng would have produced had it never been
		// snapshotted.
		const restored = createRng(999); // different seed — setState must override it
		restored.setState(capturedState);
		const continuedFromRestored = Array.from({ length: 5 }, () => restored());

		expect(continuedFromRestored).toEqual(continuedFromLive);
	});

	it("getState returns the seed itself before any advance", () => {
		const rng = createRng(123);
		expect(rng.getState()).toBe(123);
	});
});
