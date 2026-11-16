import { describe, expect, it } from "vitest";

import { buildSweepMatrix } from "./sweep-matrix";

describe("buildSweepMatrix", () => {
	it("returns exactly 20 entries", () => {
		expect(buildSweepMatrix()).toHaveLength(20);
	});

	it("has no duplicate sweepIndex values", () => {
		const indices = buildSweepMatrix().map((row) => row.sweepIndex);
		expect(new Set(indices).size).toBe(indices.length);
	});

	it("gives every entry maxDurationSeconds of 3600", () => {
		for (const row of buildSweepMatrix()) {
			expect(row.maxDurationSeconds).toBe(3600);
		}
	});
});
