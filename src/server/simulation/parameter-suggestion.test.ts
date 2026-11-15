import { describe, expect, it } from "vitest";

import {
	type SuggestionInputRow,
	suggestParameterChange,
} from "~/server/simulation/parameter-suggestion";

// Baseline values for all 15 ranged parameters — a test overrides only the
// one(s) it wants to vary, leaving the rest constant (and therefore
// correlation-ineligible) unless stated otherwise.
const BASELINE = {
	boidCount: 100,
	separationWeight: 1,
	alignmentWeight: 1,
	cohesionWeight: 1,
	maxDurationSeconds: 30,
	predatorCount: 5,
	protectionThreshold: 10,
	foodStockInitial: 100,
	foodRegenRate: 10,
	flockCount: 2,
	energyThreshold: 50,
	mutationChance: 0.1,
	mutationMagnitude: 0.2,
	xyArea: 200,
	zDepth: 200,
};

function makeRow(
	score: number,
	overrides: Partial<typeof BASELINE> = {},
): SuggestionInputRow {
	return { score, ...BASELINE, ...overrides };
}

describe("suggestParameterChange", () => {
	it("returns insufficient-data for fewer than 3 rows", () => {
		const rows = [makeRow(1, { boidCount: 10 }), makeRow(2, { boidCount: 20 })];

		expect(suggestParameterChange(rows)).toEqual({
			status: "insufficient-data",
		});
	});

	it("returns insufficient-data when no parameter varies across rows", () => {
		const rows = [makeRow(1), makeRow(2), makeRow(3), makeRow(4)];

		expect(suggestParameterChange(rows)).toEqual({
			status: "insufficient-data",
		});
	});

	it("picks the parameter with the strongest correlation among several varying candidates", () => {
		// predatorCount is perfectly linearly related to score (r = 1); boidCount
		// also varies but only weakly/noisily (|r| close to 0); every other
		// parameter stays constant (baseline) and is skipped entirely.
		//
		// predatorCount is deliberately NOT the first-iterated RANGED_PARAMETER_NAMES
		// entry (boidCount is) — this is load-bearing: an earlier version of this
		// test used boidCount as the strongly-correlated parameter, which is also
		// the first one `suggestParameterChange` iterates, so a selection bug that
		// always kept the first eligible candidate (instead of comparing
		// correlation strength) passed anyway. Confirmed via a deliberate
		// break-check: reverting the comparison to "keep the first eligible
		// candidate" made this test fail only after the swap, not before.
		const boidCounts = [10, 20, 30, 40, 50, 60];
		const predatorCounts = [5, 3, 8, 1, 9, 2];
		const scores = [5, 3, 8, 1, 9, 2];

		const rows = scores.map((score, i) =>
			makeRow(score, {
				boidCount: boidCounts[i],
				predatorCount: predatorCounts[i],
			}),
		);

		const result = suggestParameterChange(rows);
		expect(result.status).toBe("ok");
		if (result.status === "ok") {
			expect(result.parameter).toBe("predatorCount");
			expect(result.correlation).toBeCloseTo(1, 5);
		}
	});

	it("is 'high' confidence when |r| >= 0.7 and sampleSize >= 5", () => {
		const boidCounts = [10, 20, 30, 40, 50, 60];
		const scores = [1, 2, 3, 4, 5, 6];
		const rows = scores.map((score, i) =>
			makeRow(score, { boidCount: boidCounts[i] }),
		);

		const result = suggestParameterChange(rows);
		expect(result.status).toBe("ok");
		if (result.status === "ok") {
			expect(result.confidence).toBe("high");
			expect(result.sampleSize).toBe(6);
			expect(result.direction).toBe("increase");
		}
	});

	it("is 'medium' confidence when |r| is high but sampleSize < 5", () => {
		// Perfect correlation (r = 1) but only 3 rows — the high-confidence
		// threshold additionally requires sampleSize >= 5, so this must fall
		// back to medium rather than high.
		const rows = [1, 2, 3].map((n) => makeRow(n, { boidCount: n * 10 }));

		const result = suggestParameterChange(rows);
		expect(result.status).toBe("ok");
		if (result.status === "ok") {
			expect(result.correlation).toBeCloseTo(1, 5);
			expect(result.confidence).toBe("medium");
			expect(result.sampleSize).toBe(3);
		}
	});

	it("is 'medium' confidence for a moderate negative correlation (0.4 <= |r| < 0.7) and reports 'decrease'", () => {
		const boidCounts = [1, 2, 3, 4, 5, 6];
		const scores = [5, 3, 6, 1, 4, 2];
		const rows = scores.map((score, i) =>
			makeRow(score, { boidCount: boidCounts[i] }),
		);

		const result = suggestParameterChange(rows);
		expect(result.status).toBe("ok");
		if (result.status === "ok") {
			expect(result.parameter).toBe("boidCount");
			expect(result.correlation).toBeLessThan(0);
			expect(Math.abs(result.correlation)).toBeGreaterThanOrEqual(0.4);
			expect(Math.abs(result.correlation)).toBeLessThan(0.7);
			expect(result.confidence).toBe("medium");
			expect(result.direction).toBe("decrease");
		}
	});

	it("is 'low' confidence when |r| < 0.4, and still returns a suggestion rather than withholding it", () => {
		const boidCounts = [1, 2, 3, 4, 5, 6];
		const scores = [3, 5, 1, 6, 2, 4];
		const rows = scores.map((score, i) =>
			makeRow(score, { boidCount: boidCounts[i] }),
		);

		const result = suggestParameterChange(rows);
		expect(result.status).toBe("ok");
		if (result.status === "ok") {
			expect(Math.abs(result.correlation)).toBeLessThan(0.4);
			expect(result.confidence).toBe("low");
		}
	});

	it("includes the parameter's label and the sample size in the rationale", () => {
		const boidCounts = [10, 20, 30, 40, 50, 60];
		const scores = [1, 2, 3, 4, 5, 6];
		const rows = scores.map((score, i) =>
			makeRow(score, { boidCount: boidCounts[i] }),
		);

		const result = suggestParameterChange(rows);
		expect(result.status).toBe("ok");
		if (result.status === "ok") {
			expect(result.rationale).toContain("Boid count");
			expect(result.rationale).toContain("6");
		}
	});
});
