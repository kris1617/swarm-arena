import { describe, expect, it } from "vitest";
import { ScoredRun } from "~/server/simulation/scored-run";

describe("ScoredRun", () => {
	it("returns null for an unscored row", () => {
		expect(
			ScoredRun.from({ id: 1, score: null, wasEverThrottled: false }),
		).toBe(null);
	});

	it("discloses a comparable run with no disclaimer", () => {
		const run = ScoredRun.from({
			id: 1,
			score: 0.8,
			wasEverThrottled: false,
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
		});
		const disclosure = run?.disclose();
		expect(disclosure?.comparable).toBe(false);
		expect(disclosure?.score).toBe(0.8);
		expect(disclosure?.disclaimer).toContain("Run #7");
	});
});
