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

	it("separation increases the distance between two close boids", () => {
		const weights = { separation: 1, alignment: 0, cohesion: 0 };
		const a: BoidState = { x: 0, y: 0, vx: 0, vy: 0, lifespan: 100 };
		const b: BoidState = { x: 5, y: 0, vx: 0, vy: 0, lifespan: 100 };
		const before = 5;

		const [steppedA, steppedB] = stepBoids([a, b], weights, 0.1);

		const after = Math.hypot(
			(steppedB as BoidState).x - (steppedA as BoidState).x,
			(steppedB as BoidState).y - (steppedA as BoidState).y,
		);
		expect(after).toBeGreaterThan(before);
	});

	it("never lets two boids end a step closer than the hard minimum distance", () => {
		// Two boids placed exactly on top of each other with a strong pull
		// toward each other (cohesion only, no separation) — without a hard
		// floor this stays at distance 0 forever; with it, they're forced
		// apart to at least the minimum every single step.
		const weights = { separation: 0, alignment: 0, cohesion: 1 };
		let boids: BoidState[] = [
			{ x: 0, y: 0, vx: 0, vy: 0, lifespan: 100 },
			{ x: 0, y: 0, vx: 0, vy: 0, lifespan: 100 },
		];

		for (let i = 0; i < 10; i++) {
			boids = stepBoids(boids, weights, 0.1);
			const [a, b] = boids as [BoidState, BoidState];
			const dist = Math.hypot(a.x - b.x, a.y - b.y);
			expect(dist).toBeGreaterThanOrEqual(4 - 1e-9);
		}
	});

	it("clamps speed into the cruise range after steering, regardless of starting speed", () => {
		const weights = { separation: 0, alignment: 0, cohesion: 0 };
		const slow: BoidState = { x: 0, y: 0, vx: 0.01, vy: 0, lifespan: 100 };
		const fast: BoidState = { x: 0, y: 0, vx: 1000, vy: 0, lifespan: 100 };

		const [steppedSlow] = stepBoids([slow], weights, 0.1);
		const [steppedFast] = stepBoids([fast], weights, 0.1);

		const slowSpeed = Math.hypot(
			(steppedSlow as BoidState).vx,
			(steppedSlow as BoidState).vy,
		);
		const fastSpeed = Math.hypot(
			(steppedFast as BoidState).vx,
			(steppedFast as BoidState).vy,
		);
		expect(slowSpeed).toBeGreaterThanOrEqual(15 - 1e-9);
		expect(slowSpeed).toBeLessThanOrEqual(40 + 1e-9);
		expect(fastSpeed).toBeLessThanOrEqual(40 + 1e-9);
		expect(fastSpeed).toBeGreaterThanOrEqual(15 - 1e-9);
	});

	it("converges to a stable flock rather than dispersing, across several seeds (regression)", () => {
		// Verified repro: before scaling steering force to match the
		// cruise-speed clamp, some seeds (e.g. 7) dispersed to cohesion 0
		// instead of flocking, because steering was too weak to redirect
		// a fast-cruising boid before it outran its neighbors' sensing
		// radius.
		for (const seed of [1, 42, 7, 99]) {
			let boids = createInitialPopulation(100, createRng(seed), 1000);
			for (let i = 0; i < 2000; i++) {
				boids = stepBoids(boids, WEIGHTS, 0.016);
			}
			expect(computeCohesion(boids)).toBeGreaterThan(0.5);
		}
	}, 15000);

	it("does not collapse a flock to a single point over many steps (regression)", () => {
		// Verified repro: with unnormalized cohesion/alignment (the bug this
		// guards against), this exact seed/count/dt/duration collapses to
		// computeCohesion ~0.99 by t=14s. With unit-vector-normalized
		// steering, it stabilizes around ~0.4. 0.9 sits well between the two.
		let boids = createInitialPopulation(100, createRng(42), 1000);
		const dt = 0.016;
		const steps = Math.round(30 / dt);

		for (let i = 0; i < steps; i++) {
			boids = stepBoids(boids, WEIGHTS, dt);
		}

		expect(computeCohesion(boids)).toBeLessThan(0.9);
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
