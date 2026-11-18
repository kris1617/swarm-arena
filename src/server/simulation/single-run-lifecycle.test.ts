import { describe, expect, it, vi } from "vitest";

import {
	type BoidGenes,
	type BoidState,
	computeGeneticDiversity,
	type TribeConfig,
} from "~/server/simulation/boids";
import { createRng } from "~/server/simulation/rng";
import {
	computeSingleRunTick,
	MAX_DT_SECONDS,
} from "~/server/simulation/single-run-lifecycle";

const WEIGHTS = { separation: 0, alignment: 0, cohesion: 0 };
// per-tribe-food-config Phase 2: named/exported from the fixture (rather
// than an inline literal inside PARAMS.tribeConfigs) so tests that need a
// variant of this one tribe (e.g. a different foodRegenShare) can spread it
// without an array-index-access-on-possibly-undefined type error.
const BASE_TRIBE_CONFIG = {
	separation: WEIGHTS.separation,
	alignment: WEIGHTS.alignment,
	cohesion: WEIGHTS.cohesion,
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
} satisfies TribeConfig;

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
	// per-tribe-behavior-weights Phase 3: computeSingleRunTick/runTick now
	// require tribeConfigs (no default, same convention as worldSize) — this
	// file's fixtures all use flockId 0 (see GENES below), so one entry
	// matching the old global NEIGHBOR_RADIUS/SEPARATION_RADIUS/
	// PREDATOR_DETECTION_RADIUS constants keeps every pre-existing test's
	// behavior unchanged.
	tribeConfigs: [BASE_TRIBE_CONFIG],
	// predator-tribe-concept Phase 3: computeSingleRunTick/runTick now
	// require predatorTribeConfigs (no default, same convention as
	// tribeConfigs) — this file's fixtures carry no predators, so an empty
	// array keeps every pre-existing test's behavior unchanged.
	predatorTribeConfigs: [],
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
		// per-tribe-food-config Phase 5: threaded alongside foodRatioSamples —
		// empty default is fine for every pre-existing test here, none of
		// which assert on per-tribe-imbalance state.
		tribeFoodImbalanceSamples: [],
		populationCountSamples: [],
		// S-25 (FR-035): threaded alongside populationCountSamples — empty
		// default is fine for every pre-existing test here, none of which
		// assert on area-population-density state.
		populationDensitySamples: [],
		// genetic-diversity-trend Phase 1: threaded alongside
		// populationDensitySamples — empty default is fine for every
		// pre-existing test here, none of which assert on genetic-diversity
		// state.
		geneticDiversitySamples: [],
		phaseHistory: [],
		elapsedSeconds: 0,
		lastTimestamp: 0,
		hasWarnedDenseClustering: false,
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

	// genetic-diversity-trend Phase 1: one computed value per tick, matching
	// `computeGeneticDiversity` called directly on the tick's resulting
	// boid genes — acceptable here since it's testing that two call sites
	// agree on the shared pure function, not mirroring a sort/comparison
	// implementation the way a vibe-test would.
	it("appends one genetic-diversity sample per tick, computed from the tick's resulting boid genes", () => {
		let state = buildState({
			boids: [
				buildBoid({ genes: { ...GENES, maxSpeed: 40 } }),
				buildBoid({ genes: { ...GENES, maxSpeed: 60 } }),
			],
			lastTimestamp: 0,
		});

		const firstResult = computeSingleRunTick(state, 50, PARAMS);
		expect(firstResult.geneticDiversitySamples).toHaveLength(1);
		expect(firstResult.geneticDiversitySamples[0]).toBe(
			computeGeneticDiversity(firstResult.boids.map((b) => b.genes)),
		);

		state = firstResult;
		const secondResult = computeSingleRunTick(state, 100, PARAMS);
		expect(secondResult.geneticDiversitySamples).toHaveLength(2);
		expect(secondResult.geneticDiversitySamples[1]).toBe(
			computeGeneticDiversity(secondResult.boids.map((b) => b.genes)),
		);
	});

	// unwatched-run-tick-throttling Phase 2: the multiplier scales dtSeconds
	// (checked below the MAX_DT_SECONDS clamp so the scaling itself, not the
	// clamp, is what's being asserted) and flips wasThrottledThisTick.
	it("speedMultiplier: 3 produces a dtSeconds 3x the unscaled value (below the clamp) and wasThrottledThisTick: true", () => {
		const unscaledState = buildState({ lastTimestamp: 0 });
		const unscaledResult = computeSingleRunTick(unscaledState, 10, PARAMS);
		expect(unscaledResult.wasThrottledThisTick).toBe(false);

		const scaledState = buildState({ lastTimestamp: 0 });
		const scaledResult = computeSingleRunTick(scaledState, 10, {
			...PARAMS,
			speedMultiplier: 3,
		});

		expect(scaledResult.elapsedSeconds).toBeCloseTo(
			unscaledResult.elapsedSeconds * 3,
		);
		expect(scaledResult.wasThrottledThisTick).toBe(true);
	});

	// unwatched-run-tick-throttling Phase 2 (regression check): omitting
	// speedMultiplier, or passing 1 explicitly, must behave exactly as
	// before this phase — same dtSeconds, wasThrottledThisTick: false.
	it("speedMultiplier omitted (or 1) behaves identically to before this phase", () => {
		const omittedState = buildState({ lastTimestamp: 0 });
		const omittedResult = computeSingleRunTick(omittedState, 10, PARAMS);

		const explicitState = buildState({ lastTimestamp: 0 });
		const explicitResult = computeSingleRunTick(explicitState, 10, {
			...PARAMS,
			speedMultiplier: 1,
		});

		expect(omittedResult.elapsedSeconds).toBe(explicitResult.elapsedSeconds);
		expect(omittedResult.wasThrottledThisTick).toBe(false);
		expect(explicitResult.wasThrottledThisTick).toBe(false);
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

	// spatial-grid-dense-clustering-fallback Phase 3: a population of 80
	// boids colocated at the same point guarantees stepBoids' own
	// queryRadius candidate set exceeds DENSE_CLUSTER_CANDIDATE_CAP (64),
	// tripping runTick's warn-sink (boids.test.ts's "dense-cluster warn-sink
	// (Phase 2)" describe block establishes this exact pattern/count).
	it("flips hasWarnedDenseClustering to true and logs console.warn exactly once on the first tripping tick, then stays true with no further warn calls across many subsequent ticks", () => {
		const warnSpy = vi
			.spyOn(console, "warn")
			.mockImplementation(() => undefined);
		const denseBoids = Array.from({ length: 80 }, () =>
			buildBoid({ x: 0, y: 0, z: 0 }),
		);
		let state = buildState({ boids: denseBoids, lastTimestamp: 0 });
		let timestamp = 50;

		let result = computeSingleRunTick(state, timestamp, PARAMS);
		expect(result.hasWarnedDenseClustering).toBe(true);
		expect(warnSpy).toHaveBeenCalledTimes(1);

		for (let i = 0; i < 10; i++) {
			state = result;
			timestamp += 50;
			result = computeSingleRunTick(state, timestamp, PARAMS);
			expect(result.hasWarnedDenseClustering).toBe(true);
		}
		// Still exactly one call across the whole run, not one per tripping tick.
		expect(warnSpy).toHaveBeenCalledTimes(1);

		warnSpy.mockRestore();
	});

	it("never calls console.warn and keeps hasWarnedDenseClustering false for a sparse, non-tripping population", () => {
		const warnSpy = vi
			.spyOn(console, "warn")
			.mockImplementation(() => undefined);
		let state = buildState({ lastTimestamp: 0 });
		let timestamp = 0;

		for (let i = 0; i < 5; i++) {
			timestamp += 50;
			state = computeSingleRunTick(state, timestamp, PARAMS);
			expect(state.hasWarnedDenseClustering).toBe(false);
		}
		expect(warnSpy).not.toHaveBeenCalled();

		warnSpy.mockRestore();
	});

	// parameter-sweep-corpus-generation Phase 1: before this phase,
	// cohesionSamples/foodRatioSamples/populationCountSamples/
	// populationDensitySamples/geneticDiversitySamples/phaseHistory were each
	// rebuilt via `[...array, next]` every tick — a full copy per tick — and
	// phaseHistoryWindow additionally `.map()`'d over the entire grown
	// history every tick, making total cost grow faster than linearly with
	// tick count. A corpus run needs up to 225,000 ticks
	// (TICK_INTERVAL_MS=16 x maxDurationSeconds=3600); this test proves
	// several thousand ticks complete well within a generous wall-clock
	// budget, not an exact duration (timing assertions are inherently
	// approximate, so the budget below is wide margin, not a tight bound).
	it("completes several thousand ticks well within a generous wall-clock budget", () => {
		const params = { ...PARAMS, maxDurationSeconds: 1_000_000 };
		const tickCount = 20_000;

		const startedAt = Date.now();
		let timestamp = 16;
		let state: ReturnType<typeof computeSingleRunTick> = computeSingleRunTick(
			buildState({ lastTimestamp: 0 }),
			timestamp,
			params,
		);
		for (let i = 1; i < tickCount; i++) {
			timestamp += 16;
			state = computeSingleRunTick(state, timestamp, params);
		}
		const elapsedMs = Date.now() - startedAt;

		expect(state.cohesionSamples).toHaveLength(tickCount);
		expect(state.shouldStop).toBe(false);
		// Generous budget: the O(n^2) pre-fix behavior would blow well past
		// this for 20,000 ticks; the O(1)-amortized mutate-in-place fix
		// finishes in a small fraction of it.
		expect(elapsedMs).toBeLessThan(5_000);
	}, 30_000);
});

// test-plan-refresh-2026-11-16 Phase 2: mirrors the 6 live-param/
// crossbreeding behavioral-effect tests Phase 1 added for the server-owned
// path (simulation.test.ts's "simulationRouter.updateRunParams behavioral
// effects" describe block) for the client-staged path instead. There's no
// router or "live patch mid-run" concept for this pure function, so each
// test here constructs two full tick sequences from tick 0 with different
// params (a control and a test case) and compares their outcomes — never a
// re-read of the patched field itself (lessons.md: "UI accepts input is not
// feature verified"). mutationMagnitude is kept at 0.4, not the 0.9 Phase 1
// found triggers a real non-terminating engine bug (tracked separately, out
// of scope here).
describe("computeSingleRunTick client-staged live-param/crossbreeding behavioral effects", () => {
	it("a higher per-tribe foodRegenShare leaves MORE food than a lower one over the same simulated duration", () => {
		// per-tribe-food-config Phase 2: regen now sums tribeConfigs[].
		// foodRegenShare, not the flat params.foodRegenRate — retargeted from
		// the old flat-field version of this test (which this phase's own
		// change makes meaningless: foodRegenRate is still accepted/stored
		// but no longer read at this decision site, same "old scalar stays
		// in the schema, stops driving engine behavior" pattern F-09 and this
		// phase's own plan both document). foodRegenRate is deliberately set
		// to a decoy (999) on both runs to prove it's ignored.
		function foodStockAfter(foodRegenShare: number) {
			let state = buildState({ lastTimestamp: 0, foodStock: 100 });
			const params = {
				...PARAMS,
				foodRegenRate: 999,
				foodStockInitial: 100,
				tribeConfigs: [{ ...BASE_TRIBE_CONFIG, foodRegenShare }],
			};
			let timestamp = 0;
			for (let i = 0; i < 5; i++) {
				timestamp += 50;
				state = computeSingleRunTick(state, timestamp, params);
			}
			return state.foodStock;
		}

		const highFoodStock = foodStockAfter(100);
		const lowFoodStock = foodStockAfter(0);

		// A higher regen share must leave the run with MORE food than a lower
		// one did, over the identical tick window — not merely that the field
		// round-tripped through storage.
		expect(highFoodStock).toBeGreaterThan(lowFoodStock);
		expect(highFoodStock).toBeGreaterThan(100);
		expect(lowFoodStock).toBeLessThan(100);
	});

	it("raising protectionThreshold above the live boid count prevents predation on a subsequent tick, compared to a control where predation can occur", () => {
		// Boid and predator start at the same position (distance 0): with
		// every flocking weight zeroed (WEIGHTS/GENES above) and zero initial
		// velocity, stepBoids' speed-clamp branch moves the boid in a fixed
		// direction at its minSpeed, and stepPredators then steers the
		// predator straight at the boid's new position at PREDATOR_MIN_SPEED
		// — closing to well within CAPTURE_RADIUS (6) in a single tick. Same
		// fixture, only protectionThreshold differs between the two runs.
		function boidsAfterOneTick(protectionThreshold: number) {
			const state = buildState({
				boids: [buildBoid({ x: 0, y: 0, z: 0 })],
				predators: [buildBoid({ x: 0, y: 0, z: 0 })],
				lastTimestamp: 0,
			});
			const params = { ...PARAMS, protectionThreshold };
			return computeSingleRunTick(state, 50, params).boids.length;
		}

		// Above the live boid count (1): the whole population is protected.
		expect(boidsAfterOneTick(10)).toBe(1);
		// Below the live boid count from the first tick on: predation can
		// actually capture the boid.
		expect(boidsAfterOneTick(0)).toBe(0);
	});

	it("setting energyThreshold above every boid's reachable energy prevents reproduction on a subsequent tick, compared to a control where it stays low", () => {
		// Two opposite-gender, same-flock boids close enough to mate
		// (MATE_DISTANCE_RADIUS=30) and already past MATURITY_AGE_SECONDS
		// (5) — eligibility is read from the tick's own (already-aged)
		// state, so a single tick is enough to evaluate reproduction.
		function boidCountAfter(energyThreshold: number) {
			const state = buildState({
				boids: [
					buildBoid({ x: 100, y: 0, energy: 60, age: 10, gender: "a" }),
					buildBoid({ x: 105, y: 0, energy: 60, age: 10, gender: "b" }),
				],
				lastTimestamp: 0,
			});
			const params = { ...PARAMS, energyThreshold };
			return computeSingleRunTick(state, 50, params).boids.length;
		}

		// Far above ENERGY_MAX (100) — reproduction stays permanently
		// ineligible.
		expect(boidCountAfter(99999)).toBe(2);
		// Below both boids' energy (60) — eligible immediately.
		expect(boidCountAfter(1)).toBeGreaterThan(2);
	});

	it("mutationMagnitude 0 produces zero-deviation offspring genes relative to the parent average; a nonzero chance with a safe magnitude produces measurable deviation", () => {
		function newbornMaxSpeedAfter(
			mutationChance: number,
			mutationMagnitude: number,
			seed: number,
		) {
			const state = buildState({
				boids: [
					buildBoid({
						x: 100,
						y: 0,
						energy: 60,
						age: 10,
						gender: "a",
						genes: { ...GENES, maxSpeed: 30 },
					}),
					buildBoid({
						x: 105,
						y: 0,
						energy: 60,
						age: 10,
						gender: "b",
						genes: { ...GENES, maxSpeed: 50 },
					}),
				],
				lastTimestamp: 0,
			});
			const params = {
				...PARAMS,
				energyThreshold: 1,
				mutationChance,
				mutationMagnitude,
				rng: createRng(seed),
			};
			const result = computeSingleRunTick(state, 50, params);
			// Both original parents are already past age 0 (age: 10, plus this
			// tick's small dt) — any boid with age === 0 is necessarily this
			// tick's newborn.
			const newborn = result.boids.find((b) => b.age === 0);
			if (!newborn) {
				throw new Error("expected a newborn this tick");
			}
			return newborn.genes.maxSpeed;
		}

		const parentMeanMaxSpeed = (30 + 50) / 2;

		// mutationMagnitude 0 collapses blendNumber's jitter multiplier to
		// exactly 1 regardless of mutationChance, so the offspring's maxSpeed
		// must land exactly back on the parent average — not an
		// approximation of it.
		const zeroDeviationMaxSpeed = newbornMaxSpeedAfter(1, 0, 1);
		expect(zeroDeviationMaxSpeed).toBeCloseTo(parentMeanMaxSpeed, 9);

		// A real, nonzero chance with a safe magnitude (0.4, not the 0.9
		// known to hang the engine) must produce at least one measurable
		// deviation from that same average. Several seeds, not one, so the
		// assertion doesn't depend on one seed's jitter roll happening to
		// land close to the parent average.
		const deviations = [1, 2, 3, 4, 5].map((seed) =>
			Math.abs(newbornMaxSpeedAfter(1, 0.4, seed) - parentMeanMaxSpeed),
		);
		expect(Math.max(...deviations)).toBeGreaterThan(0.01);
	});

	it("toggling crossbreedingEnabled changes whether inter-flock reproduction occurs on a subsequent tick", () => {
		// Two opposite-gender boids from DIFFERENT flocks, close enough to
		// mate and already past maturity/energy eligibility — the only gate
		// between them is crossbreedingEnabled.
		function boidCountAfter(crossbreedingEnabled: boolean) {
			const state = buildState({
				boids: [
					buildBoid({
						x: 100,
						y: 0,
						energy: 60,
						age: 10,
						gender: "a",
						genes: { ...GENES, flockId: 0 },
					}),
					buildBoid({
						x: 105,
						y: 0,
						energy: 60,
						age: 10,
						gender: "b",
						genes: { ...GENES, flockId: 1 },
					}),
				],
				lastTimestamp: 0,
			});
			const params = {
				...PARAMS,
				crossbreedingEnabled,
				energyThreshold: 1,
			};
			return computeSingleRunTick(state, 50, params).boids.length;
		}

		// Disabled: the cross-flock pair is the only eligible pair, and it's
		// gated off — no reproduction occurs.
		expect(boidCountAfter(false)).toBe(2);
		// Enabled: the same pair is now eligible to mate.
		expect(boidCountAfter(true)).toBeGreaterThan(2);
	});
});

// test-plan-refresh-2026-11-16 Phase 4 (S-32): the existing genetic-diversity
// sample test above (line ~143) only proves two call sites of
// computeGeneticDiversity agree with each other — it never checks the series
// against an independently-known true diversity. These two tests build
// populations whose true diversity is a mathematical fact about the fixture
// itself (zero-variance: every boid's genes are the exact same object;
// positive-variance: boids have deliberately distinct gene values across
// multiple numeric fields and color), never by calling
// computeGeneticDiversity again.
describe("computeSingleRunTick genetic-diversity series oracle", () => {
	it("keeps every sample at exactly 0 across several ticks for a population with zero genetic variance", () => {
		// All three boids share the exact same GENES object reference — the
		// true diversity of an identical-genes population is 0 by definition,
		// independent of whatever computeGeneticDiversity computes.
		let state = buildState({
			boids: [buildBoid(), buildBoid(), buildBoid()],
			lastTimestamp: 0,
		});
		let timestamp = 0;

		for (let i = 0; i < 5; i++) {
			timestamp += 50;
			state = computeSingleRunTick(state, timestamp, PARAMS);
		}

		expect(state.geneticDiversitySamples).toHaveLength(5);
		for (const sample of state.geneticDiversitySamples) {
			expect(sample).toBeCloseTo(0, 9);
		}
	});

	it("keeps every sample measurably above 0 across several ticks for a population with deliberately distinct genes", () => {
		// Three boids whose genes differ across every scalar field
		// computeGeneticDiversity averages over (maxSpeed, minSpeed,
		// maxLifespan, separation/alignment/cohesionWeight, matePreference)
		// plus all 3 color channels — a population with known positive
		// variance on every dimension, so the true diversity is
		// mathematically > 0 regardless of the function under test.
		let state = buildState({
			boids: [
				buildBoid({
					genes: {
						...GENES,
						maxSpeed: 20,
						minSpeed: 5,
						maxLifespan: 50,
						color: { r: 255, g: 0, b: 0 },
						separationWeight: 0.2,
						alignmentWeight: 0.2,
						cohesionWeight: 0.2,
						matePreference: 0.2,
					},
				}),
				buildBoid({
					genes: {
						...GENES,
						maxSpeed: 60,
						minSpeed: 25,
						maxLifespan: 150,
						color: { r: 0, g: 255, b: 0 },
						separationWeight: 0.5,
						alignmentWeight: 0.5,
						cohesionWeight: 0.5,
						matePreference: 0.5,
					},
				}),
				buildBoid({
					genes: {
						...GENES,
						maxSpeed: 100,
						minSpeed: 45,
						maxLifespan: 250,
						color: { r: 0, g: 0, b: 255 },
						separationWeight: 0.8,
						alignmentWeight: 0.8,
						cohesionWeight: 0.8,
						matePreference: 0.8,
					},
				}),
			],
			lastTimestamp: 0,
		});
		let timestamp = 0;

		for (let i = 0; i < 5; i++) {
			timestamp += 50;
			state = computeSingleRunTick(state, timestamp, PARAMS);
		}

		expect(state.geneticDiversitySamples).toHaveLength(5);
		for (const sample of state.geneticDiversitySamples) {
			expect(sample).toBeGreaterThan(0);
		}
	});
});
