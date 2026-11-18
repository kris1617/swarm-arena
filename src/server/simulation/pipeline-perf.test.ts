import { describe, expect, it, vi } from "vitest";

import {
	createInitialPopulation,
	createInitialPredators,
	type PredatorTribeConfig,
	runTick,
	type TribeConfig,
} from "~/server/simulation/boids";
import { createRng } from "~/server/simulation/rng";

// per-tribe-behavior-weights Phase 2: createInitialPopulation/
// createInitialPredators now take `TribeConfig[]`, not `FlockWeights[]`.
const TRIBE_CONFIG: TribeConfig = {
	separation: 1,
	alignment: 1,
	cohesion: 1,
	maxSpeed: 40,
	minSpeed: 15,
	matePreference: 0.5,
	neighborRadius: 70,
	separationRadius: 25,
	predatorDetectionRadius: 50,
	burstMult: 1,
	burstCostMult: 1,
	foodStockShare: 50,
	foodRegenShare: 5,
	foodConsumptionRate: 0.5,
	crossbreedingEnabled: true,
};
// predator-tribe-concept Phase 2: createInitialPredators now takes
// `PredatorTribeConfig[]`, not `TribeConfig[]`.
const PREDATOR_TRIBE_CONFIG: PredatorTribeConfig = {
	separation: 1,
	alignment: 1,
	cohesion: 1,
	maxSpeed: 40,
	minSpeed: 15,
	matePreference: 0.5,
	detectionRadius: 50,
	captureRadiusMult: 1,
	crossbreedingEnabled: true,
};
const WORLD_SIZE = { x: 200, y: 200, z: 200 };
// protectionThreshold: 0 keeps applyPredation's scan reachable in both
// samples (never short-circuited by the "flock at/below threshold" guard).
// foodStock/foodRegenRate are generous enough that applyHunger's
// negative-stock branch never fires mid-test — it would remove boids and
// skew the ratio by shrinking a sample's population independently of the
// fixed 4x scale-up this test is measuring.
const BASE_PARAMS = {
	dtSeconds: 0.01,
	foodRegenRate: 10,
	protectionThreshold: 0,
	rng: createRng(99),
	energyThreshold: 50,
	mutationChance: 0.1,
	mutationMagnitude: 0.2,
	populationCap: 500,
	foodStockInitial: 1000,
	worldSize: WORLD_SIZE,
	// per-tribe-behavior-weights Phase 3: runTick now requires tribeConfigs
	// (no default, same convention as worldSize) — this file's single-flock
	// fixtures all use TRIBE_CONFIG, matching the old global constants
	// exactly, so grid sizing/behavior (and thus the Math.hypot call-count
	// scaling-shape this suite measures) is unchanged.
	tribeConfigs: [TRIBE_CONFIG],
	// predator-tribe-concept Phase 3: runTick now requires
	// predatorTribeConfigs (no default, same convention as tribeConfigs).
	predatorTribeConfigs: [PREDATOR_TRIBE_CONFIG],
};

function buildState(boidCount: number, predatorCount: number) {
	return {
		boids: createInitialPopulation(
			boidCount,
			createRng(1),
			100,
			1,
			[TRIBE_CONFIG],
			WORLD_SIZE,
		),
		predators: createInitialPredators(
			predatorCount,
			createRng(2),
			100,
			1,
			[PREDATOR_TRIBE_CONFIG],
			WORLD_SIZE,
		),
		foodStock: 1000,
	};
}

describe("runTick scaling-shape perf budget", () => {
	it("grows Math.hypot call count quadratically, not cubically or unboundedly, as boid/predator count scales 4x at a fixed 4:1 ratio", () => {
		// Sample A: 40 boids, 10 predators (total 50). Sample B: 160 boids,
		// 40 predators (total 200) — same 4:1 ratio, 4x scale. Math.hypot is
		// the shared primitive every distance scan in the pipeline funnels
		// through, so its call count is a direct proxy for the pipeline's
		// total operation count without timing wall-clock, which would be
		// flaky.
		//
		// S-23 note: stepBoids, applyPredation, and reproducePopulation now
		// use a spatial-hash grid instead of a full pairwise scan (see
		// context/changes/spatial-hash-performance-optimization/plan.md) —
		// but this specific band is UNCHANGED, re-measured and confirmed
		// at ~15.8, still comfortably inside [10, 22]. That's not this test
		// failing to notice the change: these samples start boids packed
		// into a 100-unit spread (the literal `100` argument below) inside
		// this engine's 200-unit wrap world, with NEIGHBOR_RADIUS=70 — dense
		// enough, and movement-per-tick small enough (dtSeconds=0.01), that
		// almost every boid is already a true neighbor of almost every
		// other one. A grid can't narrow a candidate set that's already
		// most of the population (the same finding the plan's Overview
		// documents for stepBoids' boid-boid loop specifically, confirmed
		// here independently via a different metric). The grid genuinely
		// narrows candidates for smaller-radius queries (applyPredation,
		// reproducePopulation) at other population distributions — this
		// test's specific scenario just isn't one of them.
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
