import { describe, expect, it } from "vitest";

import {
	applyHunger,
	applyPredation,
	type BoidGenes,
	type BoidState,
	computeCohesion,
	computeScore,
	createInitialPopulation,
	createInitialPredators,
	type FlockWeights,
	inheritGenes,
	type PredatorState,
	stepBoids,
	stepPredators,
} from "~/server/simulation/boids";
import { createRng } from "~/server/simulation/rng";

const WEIGHTS = { separation: 1, alignment: 1, cohesion: 1 };

// Minimal placeholder genes for raw BoidState/PredatorState literals in this
// file — most of these tests exercise steering/lifespan/wrapping, not
// genetics, so only the weights/speed genes relevant to each test vary; the
// rest are stable stand-ins that satisfy the type.
function makeGenes(
	weights: FlockWeights = WEIGHTS,
	overrides: Partial<BoidGenes> = {},
): BoidGenes {
	return {
		color: { r: 0, g: 0, b: 0 },
		flockId: 0,
		separationWeight: weights.separation,
		alignmentWeight: weights.alignment,
		cohesionWeight: weights.cohesion,
		maxSpeed: 40,
		minSpeed: 15,
		maxLifespan: 100,
		matePreference: 0,
		...overrides,
	};
}

function makeBoid(
	state: Pick<BoidState, "x" | "y" | "z" | "vx" | "vy" | "vz" | "lifespan">,
	weights: FlockWeights = WEIGHTS,
): BoidState {
	return {
		...state,
		genes: makeGenes(weights),
		energy: 0,
		age: 0,
		gender: "a",
	};
}

function makePredator(
	state: Pick<PredatorState, "x" | "y" | "z" | "vx" | "vy" | "vz" | "lifespan">,
	weights: FlockWeights = WEIGHTS,
): PredatorState {
	return {
		...state,
		genes: makeGenes(weights),
		energy: 0,
		age: 0,
		gender: "a",
	};
}

describe("createInitialPopulation", () => {
	it("produces an identical population for the same seed", () => {
		const a = createInitialPopulation(10, createRng(42), 100, 1, [WEIGHTS]);
		const b = createInitialPopulation(10, createRng(42), 100, 1, [WEIGHTS]);

		expect(a).toEqual(b);
	});
});

describe("createInitialPopulation / createInitialPredators flock split", () => {
	it("splits count evenly across flockCount and assigns distinct, deterministic colors per flock", () => {
		const flockWeights: FlockWeights[] = [WEIGHTS, WEIGHTS, WEIGHTS];

		const boids = createInitialPopulation(
			10,
			createRng(7),
			100,
			3,
			flockWeights,
		);
		const predators = createInitialPredators(
			6,
			createRng(7),
			100,
			3,
			flockWeights,
		);

		// 10 split across 3 flocks: base 3, remainder 1 -> [4, 3, 3].
		const boidCounts = [0, 1, 2].map(
			(flockId) =>
				boids.filter((boid) => boid.genes.flockId === flockId).length,
		);
		expect(boidCounts).toEqual([4, 3, 3]);

		// 6 split across 3 flocks evenly: [2, 2, 2].
		const predatorCounts = [0, 1, 2].map(
			(flockId) =>
				predators.filter((predator) => predator.genes.flockId === flockId)
					.length,
		);
		expect(predatorCounts).toEqual([2, 2, 2]);

		const colorsByFlock = [0, 1, 2].map(
			(flockId) =>
				boids.find((boid) => boid.genes.flockId === flockId)?.genes.color,
		);
		expect(
			new Set(colorsByFlock.map((color) => JSON.stringify(color))).size,
		).toBe(3);

		// Same seed, re-run — colors are deterministic, not re-rolled per call.
		const boidsAgain = createInitialPopulation(
			10,
			createRng(7),
			100,
			3,
			flockWeights,
		);
		expect(boidsAgain.map((boid) => boid.genes.color)).toEqual(
			boids.map((boid) => boid.genes.color),
		);
	});
});

describe("stepBoids", () => {
	it("is deterministic for the same input and dt", () => {
		const population = createInitialPopulation(10, createRng(1), 100, 1, [
			WEIGHTS,
		]);

		const a = stepBoids(population, 0.1);
		const b = stepBoids(population, 0.1);

		expect(a).toEqual(b);
	});

	it("steering varies with each boid's own genes, not a shared argument", () => {
		// Two otherwise-identical boids with the same neighbor but different
		// separationWeight genes — the resulting steering (and thus post-step
		// velocity) must differ, since stepBoids no longer reads a shared
		// weights argument.
		const neighbor = makeBoid({
			x: 5,
			y: 0,
			z: 0,
			vx: 0,
			vy: 0,
			vz: 0,
			lifespan: 100,
		});
		const lowSeparation = makeBoid(
			{ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, lifespan: 100 },
			{ separation: 0, alignment: 0, cohesion: 0 },
		);
		const highSeparation = makeBoid(
			{ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, lifespan: 100 },
			{ separation: 5, alignment: 0, cohesion: 0 },
		);

		const [steppedLow] = stepBoids([lowSeparation, neighbor], 0.1);
		const [steppedHigh] = stepBoids([highSeparation, neighbor], 0.1);

		expect(steppedLow?.vx).not.toBeCloseTo(steppedHigh?.vx ?? 0, 5);
	});

	it("decrements lifespan by exactly dtSeconds per step", () => {
		const boid = makeBoid({
			x: 0,
			y: 0,
			z: 0,
			vx: 0,
			vy: 0,
			vz: 0,
			lifespan: 1,
		});

		const [stepped] = stepBoids([boid], 0.25);

		expect(stepped?.lifespan).toBeCloseTo(0.75);
	});

	it("removes a boid once its lifespan reaches zero or below", () => {
		const boid = makeBoid({
			x: 0,
			y: 0,
			z: 0,
			vx: 0,
			vy: 0,
			vz: 0,
			lifespan: 0.1,
		});

		const result = stepBoids([boid], 0.25);

		expect(result).toHaveLength(0);
	});

	it("wraps x/y/z toroidally instead of letting a boid drift off indefinitely", () => {
		const weights = { separation: 0, alignment: 0, cohesion: 0 };
		// Positioned just inside each boundary, moving straight outward — one
		// tick should push each coordinate past 200 (x/y) or 200 (z) and wrap
		// it back into [0, 200) rather than leaving it negative or >=200.
		const boid = makeBoid(
			{
				x: 199,
				y: 199,
				z: 199,
				vx: 40,
				vy: 40,
				vz: 40,
				lifespan: 100,
			},
			weights,
		);

		const [stepped] = stepBoids([boid], 0.1);

		expect((stepped as BoidState).x).toBeGreaterThanOrEqual(0);
		expect((stepped as BoidState).x).toBeLessThan(200);
		expect((stepped as BoidState).y).toBeGreaterThanOrEqual(0);
		expect((stepped as BoidState).y).toBeLessThan(200);
		expect((stepped as BoidState).z).toBeGreaterThanOrEqual(0);
		expect((stepped as BoidState).z).toBeLessThan(200);
	});

	it("separation increases the distance between two close boids", () => {
		const weights = { separation: 1, alignment: 0, cohesion: 0 };
		const a = makeBoid(
			{ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, lifespan: 100 },
			weights,
		);
		const b = makeBoid(
			{ x: 5, y: 0, z: 0, vx: 0, vy: 0, vz: 0, lifespan: 100 },
			weights,
		);
		const before = 5;

		const [steppedA, steppedB] = stepBoids([a, b], 0.1);

		const after = Math.hypot(
			(steppedB as BoidState).x - (steppedA as BoidState).x,
			(steppedB as BoidState).y - (steppedA as BoidState).y,
			(steppedB as BoidState).z - (steppedA as BoidState).z,
		);
		expect(after).toBeGreaterThan(before);
	});

	it("separation increases the 3D distance between two close boids offset along z", () => {
		const weights = { separation: 1, alignment: 0, cohesion: 0 };
		const a = makeBoid(
			{ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, lifespan: 100 },
			weights,
		);
		const b = makeBoid(
			{ x: 0, y: 0, z: 5, vx: 0, vy: 0, vz: 0, lifespan: 100 },
			weights,
		);
		const before = 5;

		const [steppedA, steppedB] = stepBoids([a, b], 0.1);

		const after = Math.hypot(
			(steppedB as BoidState).x - (steppedA as BoidState).x,
			(steppedB as BoidState).y - (steppedA as BoidState).y,
			(steppedB as BoidState).z - (steppedA as BoidState).z,
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
			makeBoid(
				{ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, lifespan: 100 },
				weights,
			),
			makeBoid(
				{ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, lifespan: 100 },
				weights,
			),
		];

		for (let i = 0; i < 10; i++) {
			boids = stepBoids(boids, 0.1);
			const [a, b] = boids as [BoidState, BoidState];
			const dist = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
			expect(dist).toBeGreaterThanOrEqual(4 - 1e-9);
		}
	});

	it("never lets two boids end a step closer than the hard minimum 3D distance", () => {
		// Offset purely along z (not coincident) and closer than the hard
		// floor, pulled together by cohesion only — exercises the real
		// `nz = dz / dist` branch of resolveOverlaps, not its degenerate
		// same-point fallback. A bug that excluded z from the hard floor (or
		// pushed along x/y only) would be invisible to the x/y-only variant
		// above but caught here: without the fix this asserts against, both
		// boids collapse to z-distance 0 once cohesion pulls them together.
		const weights = { separation: 0, alignment: 0, cohesion: 1 };
		let boids: BoidState[] = [
			makeBoid(
				{ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, lifespan: 100 },
				weights,
			),
			makeBoid(
				{ x: 0, y: 0, z: 2, vx: 0, vy: 0, vz: 0, lifespan: 100 },
				weights,
			),
		];

		for (let i = 0; i < 10; i++) {
			boids = stepBoids(boids, 0.1);
			const [a, b] = boids as [BoidState, BoidState];
			const dist = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
			expect(dist).toBeGreaterThanOrEqual(4 - 1e-9);
		}
	});

	it("clamps speed into the cruise range after steering, regardless of starting speed", () => {
		const weights = { separation: 0, alignment: 0, cohesion: 0 };
		const slow = makeBoid(
			{ x: 0, y: 0, z: 0, vx: 0.01, vy: 0, vz: 0, lifespan: 100 },
			weights,
		);
		const fast = makeBoid(
			{ x: 0, y: 0, z: 0, vx: 1000, vy: 0, vz: 0, lifespan: 100 },
			weights,
		);

		const [steppedSlow] = stepBoids([slow], 0.1);
		const [steppedFast] = stepBoids([fast], 0.1);

		const slowSpeed = Math.hypot(
			(steppedSlow as BoidState).vx,
			(steppedSlow as BoidState).vy,
			(steppedSlow as BoidState).vz,
		);
		const fastSpeed = Math.hypot(
			(steppedFast as BoidState).vx,
			(steppedFast as BoidState).vy,
			(steppedFast as BoidState).vz,
		);
		expect(slowSpeed).toBeGreaterThanOrEqual(15 - 1e-9);
		expect(slowSpeed).toBeLessThanOrEqual(40 + 1e-9);
		expect(fastSpeed).toBeLessThanOrEqual(40 + 1e-9);
		expect(fastSpeed).toBeGreaterThanOrEqual(15 - 1e-9);
	});

	it("clamps 3D speed into the cruise range after steering, with a nonzero starting vz", () => {
		const weights = { separation: 0, alignment: 0, cohesion: 0 };
		const slow = makeBoid(
			{ x: 0, y: 0, z: 0, vx: 0.01, vy: 0, vz: 0.01, lifespan: 100 },
			weights,
		);
		const fast = makeBoid(
			{ x: 0, y: 0, z: 0, vx: 700, vy: 0, vz: 700, lifespan: 100 },
			weights,
		);

		const [steppedSlow] = stepBoids([slow], 0.1);
		const [steppedFast] = stepBoids([fast], 0.1);

		const slowSpeed = Math.hypot(
			(steppedSlow as BoidState).vx,
			(steppedSlow as BoidState).vy,
			(steppedSlow as BoidState).vz,
		);
		const fastSpeed = Math.hypot(
			(steppedFast as BoidState).vx,
			(steppedFast as BoidState).vy,
			(steppedFast as BoidState).vz,
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
			let boids = createInitialPopulation(100, createRng(seed), 1000, 1, [
				WEIGHTS,
			]);
			for (let i = 0; i < 2000; i++) {
				boids = stepBoids(boids, 0.016);
			}
			expect(computeCohesion(boids)).toBeGreaterThan(0.5);
		}
	}, 15000);

	it("converges to a stable flock when initially spread along z only (z-isolated)", () => {
		// All boids share the same x/y and differ only in z, with zero
		// initial velocity — isolates z-axis flocking dynamics specifically
		// (neighbor-sensing, separation, alignment, cohesion must all pull
		// correctly through z alone at the start), the way the existing
		// multi-seed test exercises x/y/z together but not z in isolation.
		let boids: BoidState[] = Array.from({ length: 20 }, (_, i) =>
			makeBoid({
				x: 100,
				y: 100,
				z: i * 10,
				vx: 0,
				vy: 0,
				vz: 0,
				lifespan: 1000,
			}),
		);

		for (let i = 0; i < 1000; i++) {
			boids = stepBoids(boids, 0.016);
		}

		// This exact symmetric spacing settles into a stable equilibrium at
		// cohesion 0.5 (verified) rather than drifting toward it — 0.4 gives
		// headroom against that exact value instead of asserting equality.
		expect(computeCohesion(boids)).toBeGreaterThan(0.4);
	});

	it("does not collapse a flock to a single point over many steps (regression)", () => {
		// Verified repro: with unnormalized cohesion/alignment (the bug this
		// guards against), this exact seed/count/dt/duration collapses to
		// computeCohesion ~0.99 by t=14s. With unit-vector-normalized
		// steering, it stabilizes around ~0.4. 0.9 sits well between the two.
		let boids = createInitialPopulation(100, createRng(42), 1000, 1, [WEIGHTS]);
		const dt = 0.016;
		const steps = Math.round(30 / dt);

		for (let i = 0; i < steps; i++) {
			boids = stepBoids(boids, dt);
		}

		expect(computeCohesion(boids)).toBeLessThan(0.9);
	});
});

describe("inheritGenes", () => {
	const parentA: BoidGenes = {
		color: { r: 0.2, g: 0.4, b: 0.6 },
		flockId: 0,
		separationWeight: 1,
		alignmentWeight: 1,
		cohesionWeight: 1,
		maxSpeed: 40,
		minSpeed: 15,
		maxLifespan: 100,
		matePreference: 0.3,
	};
	const parentB: BoidGenes = {
		color: { r: 0.8, g: 0.2, b: 0 },
		flockId: 1,
		separationWeight: 3,
		alignmentWeight: 0.5,
		cohesionWeight: 2,
		maxSpeed: 60,
		minSpeed: 25,
		maxLifespan: 200,
		matePreference: 0.9,
	};

	it("blends numeric genes to the arithmetic mean when mutationChance is 0", () => {
		const child = inheritGenes(parentA, parentB, createRng(1), 0, 0.5);

		expect(child.separationWeight).toBeCloseTo(2, 9);
		expect(child.alignmentWeight).toBeCloseTo(0.75, 9);
		expect(child.cohesionWeight).toBeCloseTo(1.5, 9);
		expect(child.maxSpeed).toBeCloseTo(50, 9);
		expect(child.minSpeed).toBeCloseTo(20, 9);
		expect(child.maxLifespan).toBeCloseTo(150, 9);
		expect(child.matePreference).toBeCloseTo(0.6, 9);
	});

	it("keeps every mutated gene within ±(mean * mutationMagnitude) of the mean when mutationChance is 1", () => {
		const mutationMagnitude = 0.2;
		const child = inheritGenes(
			parentA,
			parentB,
			createRng(2),
			1,
			mutationMagnitude,
		);

		const numericGenes: Array<[number, number]> = [
			[
				child.separationWeight,
				(parentA.separationWeight + parentB.separationWeight) / 2,
			],
			[
				child.alignmentWeight,
				(parentA.alignmentWeight + parentB.alignmentWeight) / 2,
			],
			[
				child.cohesionWeight,
				(parentA.cohesionWeight + parentB.cohesionWeight) / 2,
			],
			[child.maxSpeed, (parentA.maxSpeed + parentB.maxSpeed) / 2],
			[child.minSpeed, (parentA.minSpeed + parentB.minSpeed) / 2],
			[child.maxLifespan, (parentA.maxLifespan + parentB.maxLifespan) / 2],
			[
				child.matePreference,
				(parentA.matePreference + parentB.matePreference) / 2,
			],
		];

		for (const [value, mean] of numericGenes) {
			expect(Math.abs(value - mean)).toBeLessThanOrEqual(
				Math.abs(mean) * mutationMagnitude + 1e-9,
			);
		}
	});

	it("picks flockId as one exact parent value, never an interpolated one", () => {
		for (const seed of [1, 2, 3, 4, 5]) {
			const child = inheritGenes(parentA, parentB, createRng(seed), 1, 0.5);
			expect([parentA.flockId, parentB.flockId]).toContain(child.flockId);
		}
	});

	it("clamps mutated color channels to [0,1] even when mutation would push past the boundary", () => {
		const brightParentA: BoidGenes = {
			...parentA,
			color: { r: 1, g: 1, b: 1 },
		};
		const brightParentB: BoidGenes = {
			...parentB,
			color: { r: 1, g: 1, b: 1 },
		};

		const child = inheritGenes(
			brightParentA,
			brightParentB,
			createRng(3),
			1,
			5,
		);

		expect(child.color.r).toBeGreaterThanOrEqual(0);
		expect(child.color.r).toBeLessThanOrEqual(1);
		expect(child.color.g).toBeGreaterThanOrEqual(0);
		expect(child.color.g).toBeLessThanOrEqual(1);
		expect(child.color.b).toBeGreaterThanOrEqual(0);
		expect(child.color.b).toBeLessThanOrEqual(1);
	});
});

describe("computeCohesion", () => {
	it("returns 1.0 when every boid shares one position", () => {
		const boids: BoidState[] = Array.from({ length: 5 }, () =>
			makeBoid({ x: 10, y: 10, z: 10, vx: 0, vy: 0, vz: 0, lifespan: 100 }),
		);

		expect(computeCohesion(boids)).toBe(1);
	});

	it("returns a lower value when boids are spread out", () => {
		const tight: BoidState[] = Array.from({ length: 5 }, () =>
			makeBoid({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, lifespan: 100 }),
		);
		const spread: BoidState[] = [
			makeBoid({ x: -500, y: 0, z: 0, vx: 0, vy: 0, vz: 0, lifespan: 100 }),
			makeBoid({ x: 500, y: 0, z: 0, vx: 0, vy: 0, vz: 0, lifespan: 100 }),
			makeBoid({ x: 0, y: -500, z: 0, vx: 0, vy: 0, vz: 0, lifespan: 100 }),
			makeBoid({ x: 0, y: 500, z: 0, vx: 0, vy: 0, vz: 0, lifespan: 100 }),
		];

		expect(computeCohesion(spread)).toBeLessThan(computeCohesion(tight));
	});

	it("returns a lower value when boids are spread out along z", () => {
		const tight: BoidState[] = Array.from({ length: 5 }, () =>
			makeBoid({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, lifespan: 100 }),
		);
		const spread: BoidState[] = [
			makeBoid({ x: 0, y: 0, z: -500, vx: 0, vy: 0, vz: 0, lifespan: 100 }),
			makeBoid({ x: 0, y: 0, z: 500, vx: 0, vy: 0, vz: 0, lifespan: 100 }),
			makeBoid({ x: 0, y: 0, z: -250, vx: 0, vy: 0, vz: 0, lifespan: 100 }),
			makeBoid({ x: 0, y: 0, z: 250, vx: 0, vy: 0, vz: 0, lifespan: 100 }),
		];

		expect(computeCohesion(spread)).toBeLessThan(computeCohesion(tight));
	});
});

describe("predator-prey dynamics", () => {
	it("stepBoids with no predators arg behaves identically to the pre-change call", () => {
		// Confirms the default-empty-array backward-compat claim: omitting the
		// `predators` parameter must be bit-for-bit identical to passing an
		// explicit empty array.
		const population = createInitialPopulation(10, createRng(1), 100, 1, [
			WEIGHTS,
		]);

		const withoutArg = stepBoids(population, 0.1);
		const withEmptyArray = stepBoids(population, 0.1, []);

		expect(withoutArg).toEqual(withEmptyArray);
	});

	it("flee steering moves a boid measurably away from a nearby predator", () => {
		const weights = { separation: 0, alignment: 0, cohesion: 0 };
		const boid = makeBoid(
			{ x: 100, y: 100, z: 100, vx: 0, vy: 0, vz: 0, lifespan: 100 },
			weights,
		);
		const predator = makePredator({
			x: 95,
			y: 100,
			z: 100,
			vx: 0,
			vy: 0,
			vz: 0,
			lifespan: 100,
		});
		const distanceBefore = Math.hypot(
			boid.x - predator.x,
			boid.y - predator.y,
			boid.z - predator.z,
		);

		const [stepped] = stepBoids([boid], 0.1, [predator]);

		const distanceAfter = Math.hypot(
			(stepped as BoidState).x - predator.x,
			(stepped as BoidState).y - predator.y,
			(stepped as BoidState).z - predator.z,
		);
		expect(distanceAfter).toBeGreaterThan(distanceBefore);
	});

	it("stepPredators clamps predator speed into PREDATOR_MIN_SPEED/PREDATOR_MAX_SPEED regardless of starting speed", () => {
		const boid = makeBoid({
			x: 0,
			y: 0,
			z: 0,
			vx: 0,
			vy: 0,
			vz: 0,
			lifespan: 100,
		});
		const slow = makePredator({
			x: 10,
			y: 0,
			z: 0,
			vx: 0.01,
			vy: 0,
			vz: 0,
			lifespan: 100,
		});
		const fast = makePredator({
			x: 10,
			y: 0,
			z: 0,
			vx: 1000,
			vy: 0,
			vz: 0,
			lifespan: 100,
		});

		const [steppedSlow] = stepPredators([slow], [boid], 0.1);
		const [steppedFast] = stepPredators([fast], [boid], 0.1);

		const slowSpeed = Math.hypot(
			(steppedSlow as PredatorState).vx,
			(steppedSlow as PredatorState).vy,
			(steppedSlow as PredatorState).vz,
		);
		const fastSpeed = Math.hypot(
			(steppedFast as PredatorState).vx,
			(steppedFast as PredatorState).vy,
			(steppedFast as PredatorState).vz,
		);
		expect(slowSpeed).toBeGreaterThanOrEqual(20 - 1e-9);
		expect(slowSpeed).toBeLessThanOrEqual(55 + 1e-9);
		expect(fastSpeed).toBeGreaterThanOrEqual(20 - 1e-9);
		expect(fastSpeed).toBeLessThanOrEqual(55 + 1e-9);
	});

	it("applyHunger applies extra decay only when foodStock goes negative", () => {
		const boids: BoidState[] = [
			makeBoid({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, lifespan: 10 }),
		];

		const starved = applyHunger(boids, -5, 1, 0);
		const fed = applyHunger(boids, 1000, 1, 0);

		expect(starved.foodStock).toBeLessThan(0);
		expect(starved.boids[0]?.lifespan).toBeLessThan(10);
		expect(fed.foodStock).toBeGreaterThanOrEqual(0);
		expect(fed.boids[0]?.lifespan).toBe(10);
	});

	it("protection threshold: a flock at or below the threshold is never attacked", () => {
		// Long lifespans isolate predation from natural death — any boid loss
		// here can only be attributable to applyPredation.
		let boids: BoidState[] = Array.from({ length: 5 }, (_, i) =>
			makeBoid({ x: i, y: 0, z: 0, vx: 0, vy: 0, vz: 0, lifespan: 10_000 }),
		);
		const predators: PredatorState[] = [
			makePredator({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, lifespan: 10_000 }),
		];
		const protectionThreshold = 5;

		for (let i = 0; i < 10; i++) {
			boids = applyPredation(boids, predators, protectionThreshold);
		}

		expect(boids).toHaveLength(5);
	});

	it("protection threshold: a flock above the threshold does get attacked", () => {
		let boids: BoidState[] = Array.from({ length: 5 }, (_, i) =>
			makeBoid({ x: i, y: 0, z: 0, vx: 0, vy: 0, vz: 0, lifespan: 10_000 }),
		);
		const predators: PredatorState[] = [
			makePredator({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, lifespan: 10_000 }),
		];
		const protectionThreshold = 0;

		boids = applyPredation(boids, predators, protectionThreshold);

		expect(boids.length).toBeLessThan(5);
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
