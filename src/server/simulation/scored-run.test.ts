import { describe, expect, it } from "vitest";
import { ScoredRun } from "~/server/simulation/scored-run";

describe("ScoredRun", () => {
	it("returns null for an unscored row", () => {
		expect(
			ScoredRun.from({
				id: 1,
				score: null,
				wasEverThrottled: false,
				wasEverFoodImbalanced: false,
			}),
		).toBe(null);
	});

	it("discloses a comparable run with no disclaimer", () => {
		const run = ScoredRun.from({
			id: 1,
			score: 0.8,
			wasEverThrottled: false,
			wasEverFoodImbalanced: false,
		});
		expect(run?.disclose()).toEqual({
			score: 0.8,
			comparable: true,
			disclaimer: null,
		});
	});

	it("discloses a throttled run as non-comparable with a disclaimer naming the run", () => {
		const run = ScoredRun.from({
			id: 7,
			score: 0.8,
			wasEverThrottled: true,
			wasEverFoodImbalanced: false,
		});
		const disclosure = run?.disclose();
		expect(disclosure?.comparable).toBe(false);
		expect(disclosure?.score).toBe(0.8);
		expect(disclosure?.disclaimer).toContain("Run #7");
	});

	// per-tribe-food-config Phase 5: wasEverFoodImbalanced is a second,
	// independent comparability reason — same shape as wasEverThrottled's
	// test above.
	it("discloses an imbalanced run as non-comparable with a disclaimer naming the run", () => {
		const run = ScoredRun.from({
			id: 9,
			score: 0.8,
			wasEverThrottled: false,
			wasEverFoodImbalanced: true,
		});
		const disclosure = run?.disclose();
		expect(disclosure?.comparable).toBe(false);
		expect(disclosure?.score).toBe(0.8);
		expect(disclosure?.disclaimer).toContain("Run #9");
	});

	it("discloses a run that is both throttled and imbalanced with both disclaimers present", () => {
		const run = ScoredRun.from({
			id: 3,
			score: 0.8,
			wasEverThrottled: true,
			wasEverFoodImbalanced: true,
		});
		const disclosure = run?.disclose();
		expect(disclosure?.comparable).toBe(false);
		expect(disclosure?.disclaimer).toContain("accelerated rate");
		expect(disclosure?.disclaimer).toContain("uneven per-tribe food");
	});
});
