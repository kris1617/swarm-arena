import { describe, expect, it } from "vitest";

import {
	type BoidState,
	computeCohesion,
	computeScore,
	createInitialPopulation,
	stepBoids,
} from "~/server/simulation/boids";
import { createRng } from "~/server/simulation/rng";

const WEIGHTS = { separation: 1, alignment: 1, cohesion: 1 };

describe("createInitialPopulation", () => {
	it("produces an identical population for the same seed", () => {
		const a = createInitialPopulation(10, createRng(42), 100);
		const b = createInitialPopulation(10, createRng(42), 100);

		expect(a).toEqual(b);
	});
});

describe("stepBoids", () => {
	it("is deterministic for the same input, weights, and dt", () => {
		const population = createInitialPopulation(10, createRng(1), 100);

		const a = stepBoids(population, WEIGHTS, 0.1);
		const b = stepBoids(population, WEIGHTS, 0.1);

		expect(a).toEqual(b);
	});

	it("decrements lifespan by exactly dtSeconds per step", () => {
		const boid: BoidState = { x: 0, y: 0, vx: 0, vy: 0, lifespan: 1 };

		const [stepped] = stepBoids([boid], WEIGHTS, 0.25);

		expect(stepped?.lifespan).toBeCloseTo(0.75);
	});

	it("removes a boid once its lifespan reaches zero or below", () => {
		const boid: BoidState = { x: 0, y: 0, vx: 0, vy: 0, lifespan: 0.1 };

		const result = stepBoids([boid], WEIGHTS, 0.25);

		expect(result).toHaveLength(0);
	});
});

describe("computeCohesion", () => {
	it("returns 1.0 when every boid shares one position", () => {
		const boids: BoidState[] = Array.from({ length: 5 }, () => ({
			x: 10,
			y: 10,
			vx: 0,
			vy: 0,
			lifespan: 100,
		}));

		expect(computeCohesion(boids)).toBe(1);
	});

	it("returns a lower value when boids are spread out", () => {
		const tight: BoidState[] = Array.from({ length: 5 }, () => ({
			x: 0,
			y: 0,
			vx: 0,
			vy: 0,
			lifespan: 100,
		}));
		const spread: BoidState[] = [
			{ x: -500, y: 0, vx: 0, vy: 0, lifespan: 100 },
			{ x: 500, y: 0, vx: 0, vy: 0, lifespan: 100 },
			{ x: 0, y: -500, vx: 0, vy: 0, lifespan: 100 },
			{ x: 0, y: 500, vx: 0, vy: 0, lifespan: 100 },
		];

		expect(computeCohesion(spread)).toBeLessThan(computeCohesion(tight));
	});
});

describe("computeScore", () => {
	it("increases monotonically with elapsedTicks, holding cohesion fixed", () => {
		const samples = [0.8, 0.8, 0.8];

		expect(computeScore(samples, 20)).toBeGreaterThan(
			computeScore(samples, 10),
		);
	});

	it("increases monotonically with average cohesion, holding elapsedTicks fixed", () => {
		const lowCohesion = [0.2, 0.2, 0.2];
		const highCohesion = [0.9, 0.9, 0.9];

		expect(computeScore(highCohesion, 10)).toBeGreaterThan(
			computeScore(lowCohesion, 10),
		);
	});
});
