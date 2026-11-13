import { describe, expect, it } from "vitest";
import type {
	BoidGenes,
	BoidState,
	PredatorState,
} from "~/server/simulation/boids";
import {
	computeMultiRunTick,
	MAX_DT_SECONDS,
	type RunState,
} from "~/server/simulation/multi-run-lifecycle";
import { createRng } from "~/server/simulation/rng";
import type { RunSlot } from "~/server/simulation/run-slots";

const WEIGHTS = { separation: 0, alignment: 0, cohesion: 0 };

function makeSlot(overrides: Partial<RunSlot> = {}): RunSlot {
	return {
		runId: 1,
		seed: 1,
		boidCount: 3,
		weights: WEIGHTS,
		maxDurationSeconds: 100,
		status: "running",
		// Generous food/no predators by default — these tests exercise
		// computeMultiRunTick's own decision core (seeding, stopping,
		// draw-target selection), not the reproduction/hunger mechanics a
		// later describe block below tests directly.
		predatorCount: 0,
		protectionThreshold: 0,
		foodStockInitial: 1000,
		foodRegenRate: 10,
		// Phase 6: RunSlot now carries these five genetics fields; defaults
		// here mirror the TODO(phase 6) placeholder values this file's own
		// scenarios already assumed (energyThreshold=50 etc. in their
		// comments).
		flockCount: 1,
		crossbreedingEnabled: true,
		energyThreshold: 50,
		mutationChance: 0.1,
		mutationMagnitude: 0.2,
		...overrides,
	};
}

// Minimal placeholder genes for raw BoidState/PredatorState literals in this
// file — these tests exercise computeMultiRunTick's own decision core
// (seeding, stopping, draw-target selection, and — in the "reproduction
// parity" describe block below — growth), not steering, so the exact gene
// values don't matter beyond satisfying the type and (for the growth tests)
// carrying a flockId/gender/energy/age that mate selection reads.
function makeGenes(overrides: Partial<BoidGenes> = {}): BoidGenes {
	return {
		color: { r: 0, g: 0, b: 0 },
		flockId: 0,
		separationWeight: WEIGHTS.separation,
		alignmentWeight: WEIGHTS.alignment,
		cohesionWeight: WEIGHTS.cohesion,
		maxSpeed: 40,
		minSpeed: 15,
		maxLifespan: 100,
		matePreference: 0,
		...overrides,
	};
}

function makeBoid(
	state: Pick<BoidState, "x" | "y" | "z" | "vx" | "vy" | "vz" | "lifespan">,
	overrides: Partial<Pick<BoidState, "energy" | "age" | "gender">> &
		Partial<BoidGenes> = {},
): BoidState {
	return {
		...state,
		genes: makeGenes(overrides),
		energy: overrides.energy ?? 0,
		age: overrides.age ?? 0,
		gender: overrides.gender ?? "a",
	};
}

function makePredator(
	state: Pick<PredatorState, "x" | "y" | "z" | "vx" | "vy" | "vz" | "lifespan">,
	overrides: Partial<Pick<PredatorState, "energy" | "age" | "gender">> &
		Partial<BoidGenes> = {},
): PredatorState {
	return {
		...state,
		genes: makeGenes(overrides),
		energy: overrides.energy ?? 0,
		age: overrides.age ?? 0,
		gender: overrides.gender ?? "a",
	};
}

function makeRunState(overrides: Partial<RunState> = {}): RunState {
	return {
		boids: [
			makeBoid({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, lifespan: 1000 }),
		],
		predators: [],
		foodStock: 1000,
		rng: createRng(1),
		cohesionSamples: [],
		elapsedSeconds: 0,
		...overrides,
	};
}

describe("computeMultiRunTick", () => {
	it("seeds a fresh RunState for a running slot with no existing entry", () => {
		const slot = makeSlot({ runId: 1 });

		const result = computeMultiRunTick(
			{ runStates: {}, lastTimestamp: 0 },
			100,
			[slot],
			null,
			null,
		);

		expect(result.runStates[1]).toBeDefined();
		expect(result.runStates[1]?.boids).toHaveLength(slot.boidCount);
	});

	it("drops a runStates entry for a slot no longer in slots (dismissed)", () => {
		const existing = { 1: makeRunState() };

		const result = computeMultiRunTick(
			{ runStates: existing, lastTimestamp: 0 },
			100,
			[],
			null,
			null,
		);

		expect(result.runStates[1]).toBeUndefined();
	});

	it("stops a slot once elapsedSeconds reaches maxDurationSeconds", () => {
		const slot = makeSlot({ runId: 1, maxDurationSeconds: 0 });
		const existing = { 1: makeRunState({ elapsedSeconds: 0 }) };

		const result = computeMultiRunTick(
			{ runStates: existing, lastTimestamp: 0 },
			100,
			[slot],
			null,
			null,
		);

		expect(result.slotsToStop).toEqual([slot]);
	});

	it("stops a slot whose boids are wiped out this tick", () => {
		const slot = makeSlot({ runId: 1 });
		// A boid whose lifespan expires this tick is removed by stepBoids,
		// leaving zero boids — the population-wipe stop condition.
		const existing = {
			1: makeRunState({
				boids: [
					makeBoid({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, lifespan: 0.001 }),
				],
			}),
		};

		const result = computeMultiRunTick(
			{ runStates: existing, lastTimestamp: 0 },
			50,
			[slot],
			null,
			null,
		);

		expect(result.runStates[1]?.boids).toHaveLength(0);
		expect(result.slotsToStop).toEqual([slot]);
	});

	it("stops a slot on manual stop request and consumes the request", () => {
		const slot = makeSlot({ runId: 1 });
		const existing = { 1: makeRunState() };

		const result = computeMultiRunTick(
			{ runStates: existing, lastTimestamp: 0 },
			100,
			[slot],
			null,
			1,
		);

		expect(result.slotsToStop).toEqual([slot]);
		expect(result.nextManualStopRequestId).toBeNull();
	});

	it("leaves nextManualStopRequestId untouched when no slot matches it", () => {
		const slot = makeSlot({ runId: 1, maxDurationSeconds: 100 });
		const existing = { 1: makeRunState() };

		const result = computeMultiRunTick(
			{ runStates: existing, lastTimestamp: 0 },
			50,
			[slot],
			null,
			999,
		);

		expect(result.slotsToStop).toEqual([]);
		expect(result.nextManualStopRequestId).toBe(999);
	});

	it("returns the boids belonging to whichever runId is passed as activeRunId, switching correctly", () => {
		const slotA = makeSlot({ runId: 1 });
		const slotB = makeSlot({ runId: 2 });
		const stateA = makeRunState({
			boids: [
				makeBoid({ x: 1, y: 1, z: 1, vx: 0, vy: 0, vz: 0, lifespan: 1000 }),
			],
		});
		const stateB = makeRunState({
			boids: [
				makeBoid({ x: 2, y: 2, z: 2, vx: 0, vy: 0, vz: 0, lifespan: 1000 }),
			],
		});
		const existing = { 1: stateA, 2: stateB };

		const resultActiveA = computeMultiRunTick(
			{ runStates: existing, lastTimestamp: 0 },
			0,
			[slotA, slotB],
			1,
			null,
		);
		const resultActiveB = computeMultiRunTick(
			{ runStates: existing, lastTimestamp: 0 },
			0,
			[slotA, slotB],
			2,
			null,
		);

		expect(resultActiveA.activeDrawBoids?.[0]?.x).toBeCloseTo(1);
		expect(resultActiveB.activeDrawBoids?.[0]?.x).toBeCloseTo(2);
		expect(resultActiveA.activeDrawBoids).not.toEqual(
			resultActiveB.activeDrawBoids,
		);
	});

	it("returns null activeDrawBoids when activeRunId is null", () => {
		const slot = makeSlot({ runId: 1 });
		const existing = { 1: makeRunState() };

		const result = computeMultiRunTick(
			{ runStates: existing, lastTimestamp: 0 },
			100,
			[slot],
			null,
			null,
		);

		expect(result.activeDrawBoids).toBeNull();
	});

	it("returns null activeDrawBoids when activeRunId matches no slot/state", () => {
		const slot = makeSlot({ runId: 1 });
		const existing = { 1: makeRunState() };

		const result = computeMultiRunTick(
			{ runStates: existing, lastTimestamp: 0 },
			100,
			[slot],
			999,
			null,
		);

		expect(result.activeDrawBoids).toBeNull();
	});

	it("clamps a large timestamp gap to MAX_DT_SECONDS instead of applying the raw delta", () => {
		const slot = makeSlot({ runId: 1 });
		const existing = { 1: makeRunState({ elapsedSeconds: 0 }) };

		const result = computeMultiRunTick(
			{ runStates: existing, lastTimestamp: 0 },
			10_000,
			[slot],
			null,
			null,
		);

		expect(result.runStates[1]?.elapsedSeconds).toBeCloseTo(MAX_DT_SECONDS);
	});
});

describe("computeMultiRunTick reproduction parity with single-run", () => {
	it("grows a slot's boid AND predator population under the same eligibility/gate rules as single-run (both now via the shared runTick pipeline)", () => {
		const slot = makeSlot({ runId: 1, boidCount: 2, predatorCount: 2 });
		// Two eligible, opposite-gender, same-flock pairs per species — energy
		// (100) clears computeMultiRunTick's hardcoded energyThreshold
		// placeholder (50) and age (10) clears MATURITY_AGE_SECONDS (5). Boid
		// and predator clusters sit far apart (distance ~100, past
		// PREDATOR_DETECTION_RADIUS=50) so boid flee-steering doesn't move
		// either pair out of MATE_DISTANCE_RADIUS before reproduction runs.
		const existing = {
			1: makeRunState({
				boids: [
					makeBoid(
						{ x: 100, y: 0, z: 0, vx: 0, vy: 0, vz: 0, lifespan: 1000 },
						{ energy: 100, age: 10, gender: "a" },
					),
					makeBoid(
						{ x: 105, y: 0, z: 0, vx: 0, vy: 0, vz: 0, lifespan: 1000 },
						{ energy: 100, age: 10, gender: "b" },
					),
				],
				predators: [
					makePredator(
						{ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, lifespan: 1000 },
						{ energy: 100, age: 10, gender: "a" },
					),
					makePredator(
						{ x: 5, y: 0, z: 0, vx: 0, vy: 0, vz: 0, lifespan: 1000 },
						{ energy: 100, age: 10, gender: "b" },
					),
				],
				foodStock: 1000,
			}),
		};

		const result = computeMultiRunTick(
			{ runStates: existing, lastTimestamp: 0 },
			10,
			[slot],
			null,
			null,
		);

		const nextState = result.runStates[1];
		expect(nextState?.boids.length).toBeGreaterThan(2);
		expect(nextState?.predators.length).toBeGreaterThan(2);
	});
});

describe("computeMultiRunTick determinism across two same-seed slots", () => {
	it("produces bit-for-bit identical boids/predators across two slots driven with independently-created same-seed rng instances for the same number of ticks, including a reproduction event (Phase 3 rng-persistence parity with single-run)", () => {
		function runSlotSequence(runId: number, seed: number) {
			const slot = makeSlot({ runId, maxDurationSeconds: 1000 });
			// Mirrors this file's own "reproduction parity" describe block
			// above: explicit close-together, opposite-gender, mature,
			// high-energy boids so eligibility is deterministic rather than
			// dependent on createInitialPopulation's random spawn positions
			// landing within MATE_DISTANCE_RADIUS.
			let runStates: Record<number, RunState> = {
				[runId]: makeRunState({
					boids: [
						makeBoid(
							{ x: 100, y: 0, z: 0, vx: 0, vy: 0, vz: 0, lifespan: 1000 },
							{ energy: 40, age: 0, gender: "a" },
						),
						makeBoid(
							{ x: 105, y: 0, z: 0, vx: 0, vy: 0, vz: 0, lifespan: 1000 },
							{ energy: 40, age: 0, gender: "b" },
						),
					],
					predators: [],
					foodStock: 1000,
					rng: createRng(seed),
					elapsedSeconds: 0,
				}),
			};
			let timestamp = 0;
			// Each tick's raw 1000ms gap clamps to MAX_DT_SECONDS (0.1s), so
			// 100 ticks accrue 10s of age/energy growth — same budget as the
			// single-run determinism test, comfortably past both eligibility
			// gates (energyThreshold=50, MATURITY_AGE_SECONDS=5).
			for (let i = 0; i < 100; i++) {
				const result = computeMultiRunTick(
					{ runStates, lastTimestamp: 0 },
					timestamp,
					[slot],
					null,
					null,
				);
				runStates = result.runStates;
				timestamp += 1000;
			}
			return runStates[runId];
		}

		const resultA = runSlotSequence(1, 7);
		const resultB = runSlotSequence(2, 7);

		expect(resultA?.boids.length).toBeGreaterThan(2);
		expect(resultA?.boids).toEqual(resultB?.boids);
		expect(resultA?.predators).toEqual(resultB?.predators);
	});
});

describe("computeMultiRunTick populationCappedBySlot", () => {
	it("reports false for a running slot whose tick has no capped reproduction", () => {
		const slot = makeSlot({ runId: 1, protectionThreshold: 1 });
		const existing = {
			1: makeRunState({
				boids: [
					makeBoid({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, lifespan: 1000 }),
				],
			}),
		};

		const result = computeMultiRunTick(
			{ runStates: existing, lastTimestamp: 0 },
			50,
			[slot],
			null,
			null,
		);

		expect(result.populationCappedBySlot[1]).toBe(false);
	});

	it("reports true for a running slot whose runTick call hits the (hardcoded) populationCap via the other species' count", () => {
		// Mirrors single-run-lifecycle.test.ts's identical scenario:
		// computeMultiRunTick hardcodes runTick's populationCap at 500 (the
		// same TODO(phase 6) placeholder), so 500 filler, same-gender,
		// far-away predators clear the cap for the eligible boid pair below
		// via totalOtherPopulationCount, without needing 500 boids.
		const fillerPredators = Array.from({ length: 500 }, () =>
			makePredator(
				{ x: 0, y: 100, z: 100, vx: 0, vy: 0, vz: 0, lifespan: 1000 },
				{ gender: "a" },
			),
		);
		const slot = makeSlot({ runId: 1, protectionThreshold: 2 });
		const existing = {
			1: makeRunState({
				boids: [
					makeBoid(
						{ x: 100, y: 0, z: 0, vx: 0, vy: 0, vz: 0, lifespan: 1000 },
						{ energy: 50, age: 5, gender: "a" },
					),
					makeBoid(
						{ x: 105, y: 0, z: 0, vx: 0, vy: 0, vz: 0, lifespan: 1000 },
						{ energy: 50, age: 5, gender: "b" },
					),
				],
				predators: fillerPredators,
			}),
		};

		const result = computeMultiRunTick(
			{ runStates: existing, lastTimestamp: 0 },
			50,
			[slot],
			null,
			null,
		);

		expect(result.populationCappedBySlot[1]).toBe(true);
		expect(result.runStates[1]?.boids).toHaveLength(2);
	});
});
