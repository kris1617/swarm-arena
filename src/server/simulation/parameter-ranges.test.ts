import { describe, expect, it } from "vitest";

import {
	DEFAULT_PARAMETER_RANGES,
	RANGED_PARAMETER_NAMES,
} from "~/server/simulation/parameter-ranges";

describe("DEFAULT_PARAMETER_RANGES", () => {
	it("has exactly one entry per RANGED_PARAMETER_NAMES, no more, no fewer", () => {
		const keys = Object.keys(DEFAULT_PARAMETER_RANGES).sort();
		const names = [...RANGED_PARAMETER_NAMES].sort();
		expect(keys).toEqual(names);
	});

	it("every range satisfies min <= default <= max", () => {
		for (const name of RANGED_PARAMETER_NAMES) {
			const range = DEFAULT_PARAMETER_RANGES[name];
			expect(range.min).toBeLessThanOrEqual(range.default);
			expect(range.default).toBeLessThanOrEqual(range.max);
		}
	});
});
