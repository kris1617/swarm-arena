import { describe, expect, it } from "vitest";

import { buildDiversityChartData } from "./page";

describe("buildDiversityChartData", () => {
	it("zips a samples array into tick-indexed points", () => {
		const result = buildDiversityChartData([0.1, 0.2, 0.15]);

		expect(result).toEqual([
			{ tick: 0, diversity: 0.1 },
			{ tick: 1, diversity: 0.2 },
			{ tick: 2, diversity: 0.15 },
		]);
	});

	it("returns undefined for an older run without samples", () => {
		expect(buildDiversityChartData(undefined)).toBeUndefined();
	});

	it("returns an empty array, not undefined, for a run with zero samples", () => {
		const result = buildDiversityChartData([]);

		expect(result).toEqual([]);
		expect(result).not.toBeUndefined();
	});
});
