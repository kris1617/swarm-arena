import { describe, expect, it, vi } from "vitest";

import {
	createInitialPopulation,
	createInitialPredators,
	runTick,
} from "~/server/simulation/boids";
import { createRng } from "~/server/simulation/rng";

const WEIGHTS = { separation: 1, alignment: 1, cohesion: 1 };
// protectionThreshold: 0 keeps applyPredation's scan reachable in both
// samples (never short-circuited by the "flock at/below threshold" guard).
// foodStock/foodRegenRate are generous enough that applyHunger's
// negative-stock branch never fires mid-test — it would remove boids and
// skew the ratio by shrinking a sample's population independently of the
// fixed 4x scale-up this test is measuring.
const BASE_PARAMS = {
	weights: WEIGHTS,
	dtSeconds: 0.01,
	foodRegenRate: 10,
	protectionThreshold: 0,
};

function buildState(boidCount: number, predatorCount: number) {
	return {
		boids: createInitialPopulation(boidCount, createRng(1), 100),
		predators: createInitialPredators(predatorCount, createRng(2), 100),
		foodStock: 1000,
	};
}

describe("runTick scaling-shape perf budget", () => {
	it("grows Math.hypot call count quadratically, not cubically or unboundedly, as boid/predator count scales 4x at a fixed 4:1 ratio", () => {
		// Sample A: 40 boids, 10 predators (total 50). Sample B: 160 boids,
		// 40 predators (total 200) — same 4:1 ratio, 4x scale. Math.hypot is
		// the shared primitive every O(n^2) distance scan in the pipeline
		// (stepBoids' neighbor scan, resolveOverlaps, stepPredators' nearest-
		// boid scan, applyPredation's nearest-boid scan) funnels through, so
		// its call count is a direct proxy for the pipeline's total
		// operation count without timing wall-clock, which would be flaky.
		const sampleA = buildState(40, 10);
		const sampleB = buildState(160, 40);

		// No mockImplementation: the spy only counts calls, the real
		// computation still happens, so runTick's actual behavior (and thus
		// which conditional branches get taken) is unaffected by observing it.
		const hypotSpy = vi.spyOn(Math, "hypot");

		runTick(sampleA, BASE_PARAMS);
		const callCountA = hypotSpy.mock.calls.length;

		hypotSpy.mockClear();

		runTick(sampleB, BASE_PARAMS);
		const callCountB = hypotSpy.mock.calls.length;

		const ratio = callCountB / callCountA;

		// A 4x input scale-up predicts a 16x call-count growth under a
		// quadratic shape. This band (10-22) absorbs the fuzz introduced by
		// applyPredation's capture-dependent skip (a predator stops scanning
		// once every reachable boid is captured, vs. not) and stepBoids'
		// conditional alignMag/cohMag terms (only computed when
		// neighborCount > 0) between the two differently-seeded samples,
		// without being wide enough to admit a cubic regression's ~64x.
		expect(ratio).toBeGreaterThan(10);
		expect(ratio).toBeLessThan(22);

		hypotSpy.mockRestore();
	});
});
