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
});
