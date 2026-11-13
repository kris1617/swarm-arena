import { describe, expect, it } from "vitest";

import type { BoidGenes, BoidState } from "~/server/simulation/boids";
import {
	computeSingleRunTick,
	MAX_DT_SECONDS,
} from "~/server/simulation/single-run-lifecycle";

const WEIGHTS = { separation: 0, alignment: 0, cohesion: 0 };
const PARAMS = {
	weights: WEIGHTS,
	foodRegenRate: 0,
	protectionThreshold: 0,
	maxDurationSeconds: 100,
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
});
