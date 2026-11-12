import { describe, expect, it } from "vitest";
import {
	computeMultiRunTick,
	MAX_DT_SECONDS,
	type RunState,
} from "~/server/simulation/multi-run-lifecycle";
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
		...overrides,
	};
}

function makeRunState(overrides: Partial<RunState> = {}): RunState {
	return {
		boids: [{ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, lifespan: 1000 }],
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
				boids: [{ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, lifespan: 0.001 }],
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
			boids: [{ x: 1, y: 1, z: 1, vx: 0, vy: 0, vz: 0, lifespan: 1000 }],
		});
		const stateB = makeRunState({
			boids: [{ x: 2, y: 2, z: 2, vx: 0, vy: 0, vz: 0, lifespan: 1000 }],
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
