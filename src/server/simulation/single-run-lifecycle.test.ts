import { describe, expect, it } from "vitest";

import type { BoidGenes, BoidState } from "~/server/simulation/boids";
import { createRng } from "~/server/simulation/rng";
import {
	computeSingleRunTick,
	MAX_DT_SECONDS,
} from "~/server/simulation/single-run-lifecycle";

const WEIGHTS = { separation: 0, alignment: 0, cohesion: 0 };
const PARAMS = {
	foodRegenRate: 0,
	protectionThreshold: 0,
	maxDurationSeconds: 100,
	foodStockInitial: 100,
	// Params' own rng field — most tests below don't exercise reproduction's
	// rng-driven branches, so a fixed seed is enough to satisfy the (now
	// required) field without affecting their assertions.
	rng: createRng(1),
	// Phase 6: computeSingleRunTick now takes these as caller-supplied params
	// instead of hardcoding them — mirrors the TODO(phase 6) placeholder
	// values the tests below already assume (energyThreshold=50 etc. in
	// their own comments).
	crossbreedingEnabled: true,
	energyThreshold: 50,
	mutationChance: 0.1,
	mutationMagnitude: 0.2,
	worldSize: { x: 200, y: 200, z: 200 },
};

const GENES: BoidGenes = {
	color: { r: 0, g: 0, b: 0 },
	flockId: 0,
	separationWeight: WEIGHTS.separation,
	alignmentWeight: WEIGHTS.alignment,
	cohesionWeight: WEIGHTS.cohesion,
	maxSpeed: 40,
	minSpeed: 15,
	maxLifespan: 100,
	matePreference: 0,
};

function buildBoid(overrides: Partial<BoidState> = {}): BoidState {
	return {
		x: 0,
		y: 0,
		z: 0,
		vx: 0,
		vy: 0,
		vz: 0,
		lifespan: 1000,
		genes: GENES,
		energy: 0,
		age: 0,
		gender: "a",
		...overrides,
	};
}

function buildState(
	overrides: Partial<Parameters<typeof computeSingleRunTick>[0]> = {},
) {
	return {
		boids: [buildBoid()],
		predators: [],
		foodStock: 100,
		cohesionSamples: [],
		// S-04 (FR-010 full, FR-019): threaded alongside cohesionSamples —
		// empty defaults are fine for every pre-existing test here, none of
		// which assert on resource-management/phase-classifier state.
		foodRatioSamples: [],
		populationCountSamples: [],
		// S-25 (FR-035): threaded alongside populationCountSamples — empty
		// default is fine for every pre-existing test here, none of which
		// assert on area-population-density state.
		populationDensitySamples: [],
		phaseHistory: [],
		elapsedSeconds: 0,
		lastTimestamp: 0,
		...overrides,
	};
}

describe("computeSingleRunTick", () => {
	it("clamps a large timestamp gap to MAX_DT_SECONDS instead of applying the raw delta", () => {
		const state = buildState({ lastTimestamp: 0 });

		// A 10-second raw gap, far larger than MAX_DT_SECONDS (0.1) — elapsed
		// time should advance by exactly the clamp, not the raw 10s gap.
		const result = computeSingleRunTick(state, 10_000, PARAMS);

		expect(result.elapsedSeconds).toBeCloseTo(MAX_DT_SECONDS);
	});

	// impl-review (area-aware-population-insight, F2): Phase 1's plan called
	// for this assertion explicitly; it was missing even though the
	// Progress row was checked off. Includes a predator fixture
	// (PredatorState/PredatorGenes are structurally identical to
	// BoidState/BoidGenes — same reuse server-run-registry.test.ts's
	// fillerPredators already relies on) so this actually exercises the
	// "+predators" half of the formula, not just the boid count.
	it("appends one raw density sample per tick, computed as (boids+predators) / worldSize volume", () => {
		let state = buildState({
			lastTimestamp: 0,
			predators: [buildBoid({ x: 50 })],
		});
		const volume = PARAMS.worldSize.x * PARAMS.worldSize.y * PARAMS.worldSize.z;

		// toBe, not toBeCloseTo: these density values sit around 1e-7, and
		// toBeCloseTo's default 2-digit precision would treat any value this
		// small as "close to 0" regardless of correctness — the division is a
		// deterministic computation on the same two integers the production
		// code uses, so bit-identical equality is the right check here.
		const firstResult = computeSingleRunTick(state, 50, PARAMS);
		expect(firstResult.populationDensitySamples).toHaveLength(1);
		expect(firstResult.populationDensitySamples[0]).toBe(
			(firstResult.boids.length + firstResult.predators.length) / volume,
		);

		state = firstResult;
		const secondResult = computeSingleRunTick(state, 100, PARAMS);
		expect(secondResult.populationDensitySamples).toHaveLength(2);
		expect(secondResult.populationDensitySamples[1]).toBe(
			(secondResult.boids.length + secondResult.predators.length) / volume,
		);
	});

	it("applies zero dt on the first call (lastTimestamp: null)", () => {
		const state = buildState({ lastTimestamp: null, elapsedSeconds: 5 });

		const result = computeSingleRunTick(state, 1000, PARAMS);

		expect(result.elapsedSeconds).toBe(5);
		expect(result.lastTimestamp).toBe(1000);
	});

	it("stops once elapsedSeconds reaches maxDurationSeconds", () => {
		const state = buildState({ lastTimestamp: 0, elapsedSeconds: 99.95 });

		const result = computeSingleRunTick(state, 100, PARAMS);

		expect(result.shouldStop).toBe(true);
	});

	it("stops when the composed pipeline's output has zero boids", () => {
		// A boid whose lifespan expires this tick is removed by runTick's own
		// composed pipeline (stepBoids filters lifespan <= 0), leaving zero
		// boids — the population-wipe stop condition, independent of duration.
		const state = buildState({
			boids: [buildBoid({ lifespan: 0.001 })],
			lastTimestamp: 0,
			elapsedSeconds: 0,
		});

		const result = computeSingleRunTick(state, 50, PARAMS);

		expect(result.boids).toHaveLength(0);
		expect(result.shouldStop).toBe(true);
	});

	it("does not stop on a normal in-progress tick (contrast case)", () => {
		const state = buildState({ lastTimestamp: 0, elapsedSeconds: 1 });

		const result = computeSingleRunTick(state, 50, PARAMS);

		expect(result.shouldStop).toBe(false);
	});

	it("produces bit-for-bit identical boids/predators across two independently-driven tick sequences given the same seed, including a reproduction event (Phase 3: rng is now caller-owned/persisted, not recreated per tick)", () => {
		function runSequence(seed: number) {
			// Two opposite-gender, same-flock boids close enough to mate
			// (MATE_DISTANCE_RADIUS=30) that accrue past energyThreshold (the
			// hardcoded placeholder 50) and MATURITY_AGE_SECONDS (5) well
			// within the tick budget below.
			let state = buildState({
				boids: [
					buildBoid({ x: 100, y: 0, energy: 40, age: 0, gender: "a" }),
					buildBoid({ x: 105, y: 0, energy: 40, age: 0, gender: "b" }),
				],
				lastTimestamp: 0,
			});
			const params = {
				...PARAMS,
				maxDurationSeconds: 1000,
				rng: createRng(seed),
			};
			let timestamp = 0;
			// Each tick's raw 1000ms gap clamps to MAX_DT_SECONDS (0.1s), so
			// 100 ticks accrue 10s of age/energy growth — comfortably past
			// both eligibility gates, triggering at least one reproduction.
			for (let i = 0; i < 100; i++) {
				timestamp += 1000;
				state = computeSingleRunTick(state, timestamp, params);
			}
			return state;
		}

		const resultA = runSequence(42);
		const resultB = runSequence(42);

		// Sanity check that the scenario actually exercised reproduction's
		// rng-driven branches (inheritGenes/mutation/gender rolls), not just
		// the non-rng-dependent movement/aging code.
		expect(resultA.boids.length).toBeGreaterThan(2);
		expect(resultA.boids).toEqual(resultB.boids);
		expect(resultA.predators).toEqual(resultB.predators);
	});

	it("forwards populationCapped: false when the tick's reproduction has no capped pair", () => {
		const state = buildState({
			boids: [buildBoid({ x: 0, energy: 0, age: 0 })],
			lastTimestamp: 0,
		});

		const result = computeSingleRunTick(state, 50, PARAMS);

		expect(result.populationCapped).toBe(false);
	});

	it("forwards populationCapped: true when runTick's own populationCap gate blocks an otherwise-eligible mated pair", () => {
		// computeSingleRunTick hardcodes runTick's populationCap at 500
		// (TODO(phase 6) placeholder) and isn't itself parameterizable, so
		// the cheapest way to force `capped: true` without 500 boids is via
		// the OTHER species' count: boids' own reproducePopulation call
		// checks `population.length + offspring.length +
		// totalOtherPopulationCount >= populationCap`, and
		// totalOtherPopulationCount is the predator count. 500 filler
		// predators alone clears the cap for the boid pair below.
		//
		// Predators are placed far enough from the mating pair (euclidean
		// distance ~173, past PREDATOR_DETECTION_RADIUS=50) that boid flee
		// steering can't move the pair out of MATE_DISTANCE_RADIUS before
		// reproduction runs this tick, and all share gender "a" so they
		// never pair with each other. protectionThreshold is raised to the
		// boid count so applyPredation (which would otherwise instant-kill
		// the nearest boid to each predator once population exceeds the
		// threshold) is a no-op here — this test is about the reproduction
		// cap, not predation.
		const fillerPredators = Array.from({ length: 500 }, () =>
			buildBoid({
				x: 0,
				y: 100,
				z: 100,
				lifespan: 1000,
				gender: "a" as const,
			}),
		);
		const state = buildState({
			boids: [
				buildBoid({ x: 100, y: 0, energy: 50, age: 5, gender: "a" }),
				buildBoid({ x: 105, y: 0, energy: 50, age: 5, gender: "b" }),
			],
			predators: fillerPredators,
			lastTimestamp: 0,
		});

		const result = computeSingleRunTick(state, 50, {
			...PARAMS,
			protectionThreshold: 2,
		});

		expect(result.populationCapped).toBe(true);
		// The capped pair still gets marked paired (no double-mating) and
		// produces no offspring, per boids.ts's reproducePopulation contract.
		expect(result.boids).toHaveLength(2);
	});
});
