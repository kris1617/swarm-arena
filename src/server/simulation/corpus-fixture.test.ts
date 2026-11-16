// suggestion-quality-corpus-test Phase 1: this loader's own proof of
// correctness, and this change's first evidence that the committed
// 20-run parameter-sweep corpus loads with its full params reconstructed.
import { describe, expect, it } from "vitest";

import { loadCorpusFixture } from "./corpus-fixture";

const FULL_PARAM_FIELDS = [
	"boidCount",
	"separationWeight",
	"alignmentWeight",
	"cohesionWeight",
	"maxDurationSeconds",
	"predatorCount",
	"protectionThreshold",
	"foodStockInitial",
	"foodRegenRate",
	"flockCount",
	"crossbreedingEnabled",
	"energyThreshold",
	"mutationChance",
	"mutationMagnitude",
	"xyArea",
	"zDepth",
] as const;

describe("loadCorpusFixture", () => {
	it("returns exactly 20 rows", () => {
		expect(loadCorpusFixture()).toHaveLength(20);
	}, 15_000);

	it("has sweepIndex 1..20, all present, no duplicates", () => {
		const indices = loadCorpusFixture()
			.map((row) => row.sweepIndex)
			.sort((a, b) => a - b);
		expect(indices).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
	});

	it("reconstructs the full 16-field params for sweepIndex 1", () => {
		const row = loadCorpusFixture().find((r) => r.sweepIndex === 1);
		expect(row).toBeDefined();

		for (const field of FULL_PARAM_FIELDS) {
			expect(row?.params[field]).not.toBeUndefined();
		}

		expect(row?.params.separationWeight).toBe(0.5);
		expect(row?.params.foodRegenRate).toBe(2);
		expect(row?.params.crossbreedingEnabled).toBe(true);
		expect(row?.score).toBe(0);
	});

	it("gives every row a plain number score, never null or undefined", () => {
		for (const row of loadCorpusFixture()) {
			expect(typeof row.score).toBe("number");
		}
	});
});
