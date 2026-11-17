import { describe, expect, it } from "vitest";

import {
	applyHunger,
	applyPredation,
	type BoidGenes,
	type BoidState,
	classifyPopulationPhase,
	computeAreaPopulationDensity,
	computeCohesion,
	computeGeneticDiversity,
	computePhaseQuality,
	computeResourceManagement,
	computeScore,
	createInitialPopulation,
	createInitialPredators,
	type FlockWeights,
	inheritGenes,
	MATE_DISTANCE_RADIUS,
	MATURITY_AGE_SECONDS,
	type PopulationPhase,
	type PredatorState,
	reproducePopulation,
	runTick,
	segmentCompletedCycles,
	stepBoids,
	stepPredators,
	type TribeConfig,
} from "~/server/simulation/boids";
import { createRng } from "~/server/simulation/rng";
import type { DenseClusterWarnSink } from "~/server/simulation/spatial-grid";

const WEIGHTS = { separation: 1, alignment: 1, cohesion: 1 };
const WORLD_SIZE = { x: 200, y: 200, z: 200 };

// per-tribe-behavior-weights Phase 2: createInitialPopulation/
// createInitialPredators now take `TribeConfig[]`, not `FlockWeights[]` —
// matches WEIGHTS' separation/alignment/cohesion plus the module's old
// MAX_SPEED/MIN_SPEED constants (40/15) so every existing fixture below
// keeps producing byte-for-byte identical genes/output.
const TRIBE_CONFIG: TribeConfig = {
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
};

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
		const a = createInitialPopulation(
			10,
			createRng(42),
			100,
			1,
			[TRIBE_CONFIG],
			WORLD_SIZE,
		);
		const b = createInitialPopulation(
			10,
			createRng(42),
			100,
			1,
			[TRIBE_CONFIG],
			WORLD_SIZE,
		);

		expect(a).toEqual(b);
	});

	// per-tribe-behavior-weights Phase 2 (plan's Success Criteria): each
	// flock's boids must seed their separationWeight/maxSpeed genes from
	// THEIR OWN tribe's config, not a shared value replicated across every
	// flock — the exact regression the old `FlockWeights[]` parameter
	// (every flock reading the same weights) would reintroduce.
	it("seeds each flock's genes from its own tribe's config, not a shared value", () => {
		const tribeConfigs: TribeConfig[] = [
			{ ...TRIBE_CONFIG, separation: 0.5, maxSpeed: 20, minSpeed: 5 },
			{ ...TRIBE_CONFIG, separation: 4, maxSpeed: 90, minSpeed: 60 },
		];

		const boids = createInitialPopulation(
			20,
			createRng(11),
			100,
			2,
			tribeConfigs,
			WORLD_SIZE,
		);

		const flock0 = boids.filter((boid) => boid.genes.flockId === 0);
		const flock1 = boids.filter((boid) => boid.genes.flockId === 1);
		expect(flock0.length).toBeGreaterThan(0);
		expect(flock1.length).toBeGreaterThan(0);

		for (const boid of flock0) {
			expect(boid.genes.separationWeight).toBe(0.5);
			expect(boid.genes.maxSpeed).toBe(20);
			expect(boid.genes.minSpeed).toBe(5);
		}
		for (const boid of flock1) {
			expect(boid.genes.separationWeight).toBe(4);
			expect(boid.genes.maxSpeed).toBe(90);
			expect(boid.genes.minSpeed).toBe(60);
		}
	});
});

describe("createInitialPredators (per-tribe seeding)", () => {
	// Symmetric with the createInitialPopulation test above — predators get
	// the same per-tribe seeding (decision #5: one shared rule, not a
	// "simpler" predator path).
	it("seeds each flock's predator genes from its own tribe's config, not a shared value", () => {
		const tribeConfigs: TribeConfig[] = [
			{ ...TRIBE_CONFIG, separation: 0.5, maxSpeed: 20, minSpeed: 5 },
			{ ...TRIBE_CONFIG, separation: 4, maxSpeed: 90, minSpeed: 60 },
		];

		const predators = createInitialPredators(
			20,
			createRng(11),
			100,
			2,
			tribeConfigs,
			WORLD_SIZE,
		);

		const flock0 = predators.filter((predator) => predator.genes.flockId === 0);
		const flock1 = predators.filter((predator) => predator.genes.flockId === 1);
		expect(flock0.length).toBeGreaterThan(0);
		expect(flock1.length).toBeGreaterThan(0);

		for (const predator of flock0) {
			expect(predator.genes.separationWeight).toBe(0.5);
			expect(predator.genes.maxSpeed).toBe(20);
			expect(predator.genes.minSpeed).toBe(5);
		}
		for (const predator of flock1) {
			expect(predator.genes.separationWeight).toBe(4);
			expect(predator.genes.maxSpeed).toBe(90);
			expect(predator.genes.minSpeed).toBe(60);
		}
	});
});

describe("createInitialPopulation / createInitialPredators flock split", () => {
	it("splits count evenly across flockCount and assigns distinct, deterministic colors per flock", () => {
		const tribeConfigs: TribeConfig[] = [
			TRIBE_CONFIG,
			TRIBE_CONFIG,
			TRIBE_CONFIG,
		];

		const boids = createInitialPopulation(
			10,
			createRng(7),
			100,
			3,
			tribeConfigs,
			WORLD_SIZE,
		);
		const predators = createInitialPredators(
			6,
			createRng(7),
			100,
			3,
			tribeConfigs,
			WORLD_SIZE,
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
			tribeConfigs,
			WORLD_SIZE,
		);
		expect(boidsAgain.map((boid) => boid.genes.color)).toEqual(
			boids.map((boid) => boid.genes.color),
		);
	});

	// Characterization test (refactor-opportunities Phase 2): pins today's
	// exact flock-0 seed color as a literal value — the tests above only
	// assert shape/distinctness/determinism, so a same-shape relocation of
	// the underlying BOID_FILL_COLOR constant that silently changed the
	// actual value would still pass them unnoticed. Value captured by
	// running this exact scenario against the pre-relocation code (flock 0
	// reuses BOID_FILL_COLOR = "#38bdf8" verbatim via hexToUnitColor), same
	// precedent as the "byte-for-byte identical output" fixture at :560.
	it("pins flock 0's exact seeded color at a fixed seed (regression: relocating the underlying constant must not change the value)", () => {
		const tribeConfigs: TribeConfig[] = [
			TRIBE_CONFIG,
			TRIBE_CONFIG,
			TRIBE_CONFIG,
		];
		const boids = createInitialPopulation(
			10,
			createRng(7),
			100,
			3,
			tribeConfigs,
			WORLD_SIZE,
		);
		const flock0Color = boids.find((boid) => boid.genes.flockId === 0)?.genes
			.color;

		expect(flock0Color).toEqual({
			r: 0.2196078431372549,
			g: 0.7411764705882353,
			b: 0.9725490196078431,
		});
	});

	it("keeps flock 0 and flock 1 visually distinguishable at flockCount=2 (regression: the hue spread used to start at a fixed 0° regardless of flock 0's actual hue, so flockCount=2 could land flock 1 within ~18° of flock 0 on the color wheel — anchoring the spread at flock 0's own hue fixes this)", () => {
		const twoTribeConfigs: TribeConfig[] = [TRIBE_CONFIG, TRIBE_CONFIG];
		const boids = createInitialPopulation(
			20,
			createRng(3),
			100,
			2,
			twoTribeConfigs,
			WORLD_SIZE,
		);
		const flock0Color = boids.find((boid) => boid.genes.flockId === 0)?.genes
			.color;
		const flock1Color = boids.find((boid) => boid.genes.flockId === 1)?.genes
			.color;
		expect(flock0Color).toBeDefined();
		expect(flock1Color).toBeDefined();
		if (!flock0Color || !flock1Color) {
			return;
		}
		// Euclidean distance in [0,1]^3 RGB space — the old bug produced two
		// hues only ~18° apart (both cyan-ish), giving a distance well under
		// 0.3 here; a healthy ~180° hue separation gives a much larger one.
		const distance = Math.hypot(
			flock0Color.r - flock1Color.r,
			flock0Color.g - flock1Color.g,
			flock0Color.b - flock1Color.b,
		);
		expect(distance).toBeGreaterThan(0.3);
	});
});

describe("stepBoids", () => {
	it("is deterministic for the same input and dt", () => {
		const population = createInitialPopulation(
			10,
			createRng(1),
			100,
			1,
			[TRIBE_CONFIG],
			WORLD_SIZE,
		);

		const a = stepBoids(population, 0.1, WORLD_SIZE);
		const b = stepBoids(population, 0.1, WORLD_SIZE);

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

		const [steppedLow] = stepBoids([lowSeparation, neighbor], 0.1, WORLD_SIZE);
		const [steppedHigh] = stepBoids(
			[highSeparation, neighbor],
			0.1,
			WORLD_SIZE,
		);

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

		const [stepped] = stepBoids([boid], 0.25, WORLD_SIZE);

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

		const result = stepBoids([boid], 0.25, WORLD_SIZE);

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

		const [stepped] = stepBoids([boid], 0.1, WORLD_SIZE);

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

		const [steppedA, steppedB] = stepBoids([a, b], 0.1, WORLD_SIZE);

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

		const [steppedA, steppedB] = stepBoids([a, b], 0.1, WORLD_SIZE);

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
			boids = stepBoids(boids, 0.1, WORLD_SIZE);
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
			boids = stepBoids(boids, 0.1, WORLD_SIZE);
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

		const [steppedSlow] = stepBoids([slow], 0.1, WORLD_SIZE);
		const [steppedFast] = stepBoids([fast], 0.1, WORLD_SIZE);

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

		const [steppedSlow] = stepBoids([slow], 0.1, WORLD_SIZE);
		const [steppedFast] = stepBoids([fast], 0.1, WORLD_SIZE);

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
		//
		// S-23: the spatial-hash grid measurably slows this exact scenario
		// down (NEIGHBOR_RADIUS=70 covers ~18% of this world's volume, so
		// almost every boid is already a true neighbor — the grid can't
		// narrow a candidate set that's already most of the population, and
		// pays cell-lookup/sort overhead on top; measured ~2x slower than
		// the pre-S-23 pairwise scan at this exact population/tick count).
		// Kept anyway for implementation consistency across every neighbor
		// query in this file (explicit decision, not an oversight) — the
		// timeout below is widened accordingly, not because this got slow
		// by accident.
		for (const seed of [1, 42, 7, 99]) {
			let boids = createInitialPopulation(
				100,
				createRng(seed),
				1000,
				1,
				[TRIBE_CONFIG],
				WORLD_SIZE,
			);
			for (let i = 0; i < 2000; i++) {
				boids = stepBoids(boids, 0.016, WORLD_SIZE);
			}
			expect(computeCohesion(boids, WORLD_SIZE)).toBeGreaterThan(0.5);
		}
	}, 30000);

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
			boids = stepBoids(boids, 0.016, WORLD_SIZE);
		}

		// This exact symmetric spacing settles into a stable equilibrium at
		// cohesion 0.5 (verified) rather than drifting toward it — 0.4 gives
		// headroom against that exact value instead of asserting equality.
		expect(computeCohesion(boids, WORLD_SIZE)).toBeGreaterThan(0.4);
	});

	it("does not collapse a flock to a single point over many steps (regression)", () => {
		// Verified repro: with unnormalized cohesion/alignment (the bug
		// this guards against), this exact seed/count/dt/duration
		// collapses to computeCohesion ~0.99 by t=14s. With
		// unit-vector-normalized steering, it stabilizes around ~0.4.
		// 0.9 sits well between the two.
		//
		// S-23: widened from the 5000ms default for the same reason as
		// the "converges to a stable flock" test above — the grid
		// measurably slows this exact (dense, small-world) scenario
		// down; kept anyway for implementation consistency, by explicit
		// decision (see plan.md's Overview).
		let boids = createInitialPopulation(
			100,
			createRng(42),
			1000,
			1,
			[TRIBE_CONFIG],
			WORLD_SIZE,
		);
		const dt = 0.016;
		const steps = Math.round(30 / dt);

		for (let i = 0; i < steps; i++) {
			boids = stepBoids(boids, dt, WORLD_SIZE);
		}

		expect(computeCohesion(boids, WORLD_SIZE)).toBeLessThan(0.9);
	}, 15000);
});

// per-tribe-behavior-weights Phase 3: the plan's own named Success
// Criterion — "a boid in a tribe with a small separationRadius ignores a
// neighbor at a distance that a large-radius tribe's identical boid would
// react to". Exercises the optional 6th `tribeConfigs` param directly
// (every other stepBoids call in this file omits it, relying on the
// fallback-to-global-constants default — see stepBoids' own comment).
describe("stepBoids (per-tribe-behavior-weights Phase 3: per-tribe perception radii)", () => {
	it("a boid in a tribe with a small separationRadius ignores a neighbor that an identical boid in a large-radius tribe reacts to", () => {
		const weights = { separation: 1, alignment: 0, cohesion: 0 };
		const tribeConfigs: TribeConfig[] = [
			{ ...TRIBE_CONFIG, separationRadius: 5 },
			{ ...TRIBE_CONFIG, separationRadius: 50 },
		];
		// Strictly between the two tribes' separationRadius (5 and 50), and
		// well inside both tribes' shared neighborRadius (70) so the neighbor
		// is "seen" either way — only the separation contribution differs.
		const distance = 10;

		function buildSubject(flockId: number): BoidState {
			return {
				x: 0,
				y: 0,
				z: 0,
				vx: 0,
				vy: 0,
				vz: 0,
				lifespan: 100,
				genes: makeGenes(weights, { flockId }),
				energy: 0,
				age: 0,
				gender: "a",
			};
		}
		const neighbor = makeBoid(
			{ x: distance, y: 0, z: 0, vx: 0, vy: 0, vz: 0, lifespan: 100 },
			weights,
		);

		const smallRadiusSubject = buildSubject(0);
		const largeRadiusSubject = buildSubject(1);

		const [steppedSmall] = stepBoids(
			[smallRadiusSubject, neighbor],
			0.1,
			WORLD_SIZE,
			[],
			undefined,
			tribeConfigs,
		);
		const [steppedLarge] = stepBoids(
			[largeRadiusSubject, neighbor],
			0.1,
			WORLD_SIZE,
			[],
			undefined,
			tribeConfigs,
		);

		// Small-radius tribe (separationRadius=5 < distance=10): no
		// separation force applies, so steering is zero and the boid falls
		// back to the speed-clamp floor's fixed fallback direction (+x).
		expect(steppedSmall?.vx).toBeGreaterThan(0);
		// Large-radius tribe (separationRadius=50 > distance=10): separation
		// pushes the boid away from the neighbor (which sits at +x), so the
		// resulting velocity points in -x instead.
		expect(steppedLarge?.vx).toBeLessThan(0);
	});
});

// S-24 (configurable-area-and-camera-view) Phase 1: proves the
// INITIAL_AREA_SIZE/Z_DEPTH_RANGE -> worldSize refactor is behavior-
// preserving at the default (200/200/200) world and genuinely
// deterministic — not just "runs without crashing" — at a non-default
// world size, same standard S-23 held the spatial-hash grid to.
describe("worldSize parameterization (S-24)", () => {
	it("produces byte-for-byte identical output to a captured pre-refactor fixture at the default 200-unit world", () => {
		const boids = createInitialPopulation(
			5,
			createRng(123),
			100,
			1,
			[TRIBE_CONFIG],
			WORLD_SIZE,
		);
		const stepped = stepBoids(boids, 0.1, WORLD_SIZE);

		// Fixture captured by running this exact scenario against the
		// refactored (worldSize-parameterized) code at worldSize = {200,
		// 200, 200} — the pre-refactor code read the same 200-unit value
		// from the now-deleted INITIAL_AREA_SIZE/Z_DEPTH_RANGE constants,
		// so identical output here is the regression guard that this
		// refactor changed nothing by default.
		// per-tribe-behavior-weights impl-review F1 fix: values shifted again
		// here — matePreference now seeds from tribeConfig.matePreference
		// instead of its own rng() call, so every boid after the first
		// consumes the shared seeded RNG stream one call earlier than
		// before, an intentional consequence of the fix, re-captured against
		// this exact scenario.
		expect(
			stepped.map((b) => ({
				x: b.x,
				y: b.y,
				z: b.z,
				vx: b.vx,
				vy: b.vy,
				vz: b.vz,
			})),
		).toEqual([
			{
				x: 157.23711918963866,
				y: 36.532711463371506,
				z: 97.82796308257154,
				vx: -2.132054798416487,
				vy: 8.239983509725224,
				vz: -12.351397252780986,
			},
			{
				x: 186.10842478042977,
				y: 158.10095839699073,
				z: 81.02983780181638,
				vx: 2.8969960799950867,
				vy: 12.425009117768507,
				vz: -7.888381464905369,
			},
			{
				x: 118.28205716685532,
				y: 70.20790834870421,
				z: 105.4272673674382,
				vx: 1.2018010840891544,
				vy: -8.77128057589308,
				vz: 12.108687427349134,
			},
			{
				x: 30.687101682389798,
				y: 9.364894402918452,
				z: 21.615157557972015,
				vx: 1.125051022718585,
				vy: 11.998280861946286,
				vz: -8.931714088243831,
			},
			{
				x: 184.16330194649314,
				y: 142.00166948856122,
				z: 190.33151722924785,
				vx: -14.300236982383828,
				vy: 3.420747888208065,
				vz: -2.9667669495566837,
			},
		]);
	});

	it("is deterministic at a non-default world size, not just the default one", () => {
		const nonDefaultWorld = { x: 400, y: 400, z: 400 };

		function runScenario() {
			let boids = createInitialPopulation(
				20,
				createRng(7),
				100,
				1,
				[TRIBE_CONFIG],
				nonDefaultWorld,
			);
			for (let i = 0; i < 50; i++) {
				boids = stepBoids(boids, 0.1, nonDefaultWorld);
			}
			return boids;
		}

		const a = runScenario();
		const b = runScenario();

		expect(a).toEqual(b);
		// Sanity check this scenario actually ran at the non-default size —
		// not a vacuous pass from an empty/trivial population.
		expect(a.length).toBeGreaterThan(0);
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

describe("reproducePopulation", () => {
	const ELIGIBLE_ENERGY = 50;
	const BASE_REPRODUCTION_PARAMS = {
		crossbreedingEnabled: true,
		energyThreshold: ELIGIBLE_ENERGY,
		mutationChance: 0,
		mutationMagnitude: 0.2,
		populationCap: 500,
		totalOtherPopulationCount: 0,
	};

	// Reproduction-focused factory, independent of this file's
	// steering-focused makeBoid/makePredator above — these tests need to vary
	// energy/age/gender/flockId (what reproducePopulation reads), not
	// steering weights.
	function makeEligibleGenes(overrides: Partial<BoidGenes> = {}): BoidGenes {
		return {
			color: { r: 0, g: 0, b: 0 },
			flockId: 0,
			separationWeight: 0,
			alignmentWeight: 0,
			cohesionWeight: 0,
			maxSpeed: 40,
			minSpeed: 15,
			maxLifespan: 100,
			matePreference: 0,
			...overrides,
		};
	}

	function makeIndividual(
		overrides: {
			x?: number;
			energy?: number;
			age?: number;
			gender?: "a" | "b";
			genes?: Partial<BoidGenes>;
		} = {},
	): BoidState {
		return {
			x: overrides.x ?? 0,
			y: 0,
			z: 0,
			vx: 0,
			vy: 0,
			vz: 0,
			lifespan: 100,
			genes: makeEligibleGenes(overrides.genes),
			energy: overrides.energy ?? ELIGIBLE_ENERGY,
			age: overrides.age ?? MATURITY_AGE_SECONDS,
			gender: overrides.gender ?? "a",
		};
	}

	it("grows the population by exactly one for an eligible, opposite-gender, same-flock pair within mate distance", () => {
		const population = [
			makeIndividual({ x: 0, gender: "a" }),
			makeIndividual({ x: MATE_DISTANCE_RADIUS - 1, gender: "b" }),
		];

		const result = reproducePopulation(
			population,
			createRng(1),
			BASE_REPRODUCTION_PARAMS,
			WORLD_SIZE,
		);

		expect(result.population).toHaveLength(3);
		expect(result.capped).toBe(false);
	});

	it("crossbreeding guardrail: a cross-flock pair mates only when crossbreedingEnabled is true", () => {
		const crossFlockPopulation = [
			makeIndividual({ x: 0, gender: "a", genes: { flockId: 0 } }),
			makeIndividual({
				x: MATE_DISTANCE_RADIUS - 1,
				gender: "b",
				genes: { flockId: 1 },
			}),
		];

		const withCrossbreedingOff = reproducePopulation(
			crossFlockPopulation,
			createRng(1),
			{ ...BASE_REPRODUCTION_PARAMS, crossbreedingEnabled: false },
			WORLD_SIZE,
		);
		// Never a blended-flock offspring: no offspring at all, since a
		// cross-flock pair never even mates when the gate is off.
		expect(withCrossbreedingOff.population).toHaveLength(2);

		const withCrossbreedingOn = reproducePopulation(
			crossFlockPopulation,
			createRng(1),
			{ ...BASE_REPRODUCTION_PARAMS, crossbreedingEnabled: true },
			WORLD_SIZE,
		);
		expect(withCrossbreedingOn.population).toHaveLength(3);
	});

	it("never reproduces below the energy threshold, regardless of a nearby eligible mate", () => {
		const population = [
			makeIndividual({ x: 0, gender: "a", energy: ELIGIBLE_ENERGY - 1 }),
			makeIndividual({ x: MATE_DISTANCE_RADIUS - 1, gender: "b" }),
		];

		const result = reproducePopulation(
			population,
			createRng(1),
			BASE_REPRODUCTION_PARAMS,
			WORLD_SIZE,
		);

		expect(result.population).toHaveLength(2);
	});

	it("never reproduces below MATURITY_AGE_SECONDS, regardless of a nearby eligible mate", () => {
		const population = [
			makeIndividual({
				x: 0,
				gender: "a",
				age: MATURITY_AGE_SECONDS - 0.1,
			}),
			makeIndividual({ x: MATE_DISTANCE_RADIUS - 1, gender: "b" }),
		];

		const result = reproducePopulation(
			population,
			createRng(1),
			BASE_REPRODUCTION_PARAMS,
			WORLD_SIZE,
		);

		expect(result.population).toHaveLength(2);
	});

	it("at populationCap, an otherwise-eligible mated pair produces no offspring and capped is true", () => {
		const population = [
			makeIndividual({ x: 0, gender: "a" }),
			makeIndividual({ x: MATE_DISTANCE_RADIUS - 1, gender: "b" }),
		];

		const result = reproducePopulation(
			population,
			createRng(1),
			{
				...BASE_REPRODUCTION_PARAMS,
				populationCap: 2,
			},
			WORLD_SIZE,
		);

		expect(result.population).toHaveLength(2);
		expect(result.capped).toBe(true);
	});

	it(
		"pairs with the lowest-index eligible mate in range, not the nearest " +
			"one (S-23: the grid's ascending-index-sort contract is what " +
			"keeps this identical to the pre-grid pairwise scan)",
		() => {
			// candidateFar (index 1) is farther from parentA than
			// candidateNear (index 2), but both are well within
			// MATE_DISTANCE_RADIUS and otherwise equally eligible. The
			// documented rule is first-match-by-ascending-index, not
			// nearest-match — if a grid-optimized scan ever iterated
			// candidates in distance order instead of the required
			// ascending-index order, this test would catch it by expecting
			// the farther, lower-index candidate to win.
			const parentA = makeIndividual({ x: 0, gender: "a" });
			const candidateFar = makeIndividual({
				x: MATE_DISTANCE_RADIUS - 1,
				gender: "b",
			});
			const candidateNear = makeIndividual({ x: 1, gender: "b" });

			const result = reproducePopulation(
				[parentA, candidateFar, candidateNear],
				createRng(1),
				BASE_REPRODUCTION_PARAMS,
				WORLD_SIZE,
			);

			// Exactly one offspring (index 0 paired with index 1); index 2
			// (candidateNear) stays unpaired this tick. Spawn x is the plain
			// midpoint of parentA/candidateFar (0 and MATE_DISTANCE_RADIUS-1
			// are both far from the wrap seam, so no wrap-around arithmetic
			// is in play here) — if candidateNear (x=1) had instead been
			// picked, the spawn x would be ~0.5, not ~14.5.
			expect(result.population).toHaveLength(4);
			const offspring = result.population[3];
			expect(offspring?.x).toBeCloseTo((parentA.x + candidateFar.x) / 2, 5);
		},
	);

	it("mate-preference gate (Phase 5): an in-range, opposite-gender pair with very different colors does NOT pair when either parent's matePreference is too low", () => {
		const population = [
			makeIndividual({
				x: 0,
				gender: "a",
				genes: { color: { r: 0, g: 0, b: 0 }, matePreference: 0.1 },
			}),
			makeIndividual({
				x: MATE_DISTANCE_RADIUS - 1,
				gender: "b",
				genes: { color: { r: 1, g: 1, b: 1 }, matePreference: 10 },
			}),
		];

		const result = reproducePopulation(
			population,
			createRng(1),
			BASE_REPRODUCTION_PARAMS,
			WORLD_SIZE,
		);

		// colorDistSq = 3 (1^2 * 3 channels); parentA's matePreference^2 =
		// 0.01, so parentA rejects the match even though parentB's own
		// threshold (100) would accept it — both sides must agree.
		expect(result.population).toHaveLength(2);
	});

	it("mate-preference gate (Phase 5): the same very-different-colored pair DOES pair when both parents' matePreference is high enough", () => {
		const population = [
			makeIndividual({
				x: 0,
				gender: "a",
				genes: { color: { r: 0, g: 0, b: 0 }, matePreference: 10 },
			}),
			makeIndividual({
				x: MATE_DISTANCE_RADIUS - 1,
				gender: "b",
				genes: { color: { r: 1, g: 1, b: 1 }, matePreference: 10 },
			}),
		];

		const result = reproducePopulation(
			population,
			createRng(1),
			BASE_REPRODUCTION_PARAMS,
			WORLD_SIZE,
		);

		// colorDistSq = 3; both matePreference^2 = 100, well above 3, so the
		// pair mates.
		expect(result.population).toHaveLength(3);
	});

	it("predators reproduce under the identical helper (decision #5's symmetry)", () => {
		const population: PredatorState[] = [
			makeIndividual({ x: 0, gender: "a" }),
			makeIndividual({ x: MATE_DISTANCE_RADIUS - 1, gender: "b" }),
		];

		const result = reproducePopulation(
			population,
			createRng(1),
			BASE_REPRODUCTION_PARAMS,
			WORLD_SIZE,
		);

		expect(result.population).toHaveLength(3);
		expect(result.capped).toBe(false);
	});
});

describe("computeCohesion", () => {
	it("returns 1.0 when every boid shares one position", () => {
		const boids: BoidState[] = Array.from({ length: 5 }, () =>
			makeBoid({ x: 10, y: 10, z: 10, vx: 0, vy: 0, vz: 0, lifespan: 100 }),
		);

		expect(computeCohesion(boids, WORLD_SIZE)).toBe(1);
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

		expect(computeCohesion(spread, WORLD_SIZE)).toBeLessThan(
			computeCohesion(tight, WORLD_SIZE),
		);
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

		expect(computeCohesion(spread, WORLD_SIZE)).toBeLessThan(
			computeCohesion(tight, WORLD_SIZE),
		);
	});
});

describe("predator-prey dynamics", () => {
	it("stepBoids with no predators arg behaves identically to the pre-change call", () => {
		// Confirms the default-empty-array backward-compat claim: omitting the
		// `predators` parameter must be bit-for-bit identical to passing an
		// explicit empty array.
		const population = createInitialPopulation(
			10,
			createRng(1),
			100,
			1,
			[TRIBE_CONFIG],
			WORLD_SIZE,
		);

		const withoutArg = stepBoids(population, 0.1, WORLD_SIZE);
		const withEmptyArray = stepBoids(population, 0.1, WORLD_SIZE, []);

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

		const [stepped] = stepBoids([boid], 0.1, WORLD_SIZE, [predator]);

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

		const [steppedSlow] = stepPredators([slow], [boid], 0.1, WORLD_SIZE);
		const [steppedFast] = stepPredators([fast], [boid], 0.1, WORLD_SIZE);

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
			boids = applyPredation(boids, predators, protectionThreshold, WORLD_SIZE);
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

		boids = applyPredation(boids, predators, protectionThreshold, WORLD_SIZE);

		expect(boids.length).toBeLessThan(5);
	});
});

// per-tribe-behavior-weights Phase 4: the speed-burst mechanic, ported from
// the Lua reference's Boid:update (burstMult on velocity, burstCostMult on
// the new energy drain) — see boids.ts's BOID_ENERGY_BASE_COST/
// BOID_ENERGY_MOVE_COST_COEFFICIENT comment for the calibration reasoning.
// TRIBE_CONFIG's own burstMult/burstCostMult are both 1 (no-op), so every
// test above this block that reuses it is unaffected by this mechanic —
// these tests use a dedicated tribe config with real (>1) burst values,
// matching the Lua reference's own tribe ranges (burstMult 1.5-1.6,
// burstCostMult 3.0-3.5).
describe("speed burst and energy drain (per-tribe-behavior-weights Phase 4)", () => {
	const BURST_TRIBE_CONFIG: TribeConfig = {
		...TRIBE_CONFIG,
		burstMult: 1.5,
		burstCostMult: 3,
	};

	it("stepBoids multiplies a bursting boid's clamped velocity by its tribe's burstMult, exceeding its own maxSpeed ceiling", () => {
		const weights = { separation: 0, alignment: 0, cohesion: 0 };
		// A huge initial vx (aligned with the flee direction, away from the
		// predator below) guarantees the pre-burst clamp saturates at exactly
		// genes.maxSpeed, so the post-burst result is predictable:
		// genes.maxSpeed * burstMult, not some smaller unsaturated value.
		const boid = makeBoid(
			{ x: 100, y: 100, z: 100, vx: 1000, vy: 0, vz: 0, lifespan: 100 },
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

		const [burstStepped] = stepBoids(
			[boid],
			0.1,
			WORLD_SIZE,
			[predator],
			undefined,
			[BURST_TRIBE_CONFIG],
		);
		const [noBurstStepped] = stepBoids(
			[boid],
			0.1,
			WORLD_SIZE,
			[predator],
			undefined,
			[TRIBE_CONFIG],
		);

		const burstSpeed = Math.hypot(
			(burstStepped as BoidState).vx,
			(burstStepped as BoidState).vy,
			(burstStepped as BoidState).vz,
		);
		const noBurstSpeed = Math.hypot(
			(noBurstStepped as BoidState).vx,
			(noBurstStepped as BoidState).vy,
			(noBurstStepped as BoidState).vz,
		);

		expect(noBurstSpeed).toBeCloseTo(boid.genes.maxSpeed, 5);
		expect(burstSpeed).toBeGreaterThan(boid.genes.maxSpeed);
		expect(burstSpeed).toBeCloseTo(boid.genes.maxSpeed * 1.5, 5);
	});

	it("runTick success criterion: a boid with a predator inside predatorDetectionRadius moves faster and loses more net energy this tick than an otherwise-identical boid with no nearby predator", () => {
		const weights = { separation: 0, alignment: 0, cohesion: 0 };
		const startingEnergy = 50;

		function buildFreshBoid(): BoidState {
			return {
				...makeBoid(
					{ x: 100, y: 100, z: 100, vx: 1000, vy: 0, vz: 0, lifespan: 100 },
					weights,
				),
				energy: startingEnergy,
			};
		}
		const predator = makePredator({
			x: 95,
			y: 100,
			z: 100,
			vx: 0,
			vy: 0,
			vz: 0,
			lifespan: 100,
		});

		const sharedParams = {
			dtSeconds: 0.1,
			foodRegenRate: 0,
			// Above the single-boid population so applyPredation is a no-op —
			// this test is about the burst/energy mechanic, not capture.
			protectionThreshold: 10,
			rng: createRng(1),
			crossbreedingEnabled: true,
			energyThreshold: 99999,
			mutationChance: 0,
			mutationMagnitude: 0,
			populationCap: 1000,
			foodStockInitial: 1000,
			worldSize: WORLD_SIZE,
			tribeConfigs: [BURST_TRIBE_CONFIG],
		};

		const fleeingResult = runTick(
			{ boids: [buildFreshBoid()], predators: [predator], foodStock: 1000 },
			sharedParams,
		);
		const calmResult = runTick(
			{ boids: [buildFreshBoid()], predators: [], foodStock: 1000 },
			sharedParams,
		);

		const fleeingBoid = fleeingResult.boids[0];
		const calmBoid = calmResult.boids[0];
		if (!fleeingBoid || !calmBoid) {
			throw new Error("expected both boids to survive this tick");
		}

		const fleeingSpeed = Math.hypot(
			fleeingBoid.vx,
			fleeingBoid.vy,
			fleeingBoid.vz,
		);
		const calmSpeed = Math.hypot(calmBoid.vx, calmBoid.vy, calmBoid.vz);
		expect(fleeingSpeed).toBeGreaterThan(calmSpeed);

		const fleeingEnergyDelta = fleeingBoid.energy - startingEnergy;
		const calmEnergyDelta = calmBoid.energy - startingEnergy;
		expect(fleeingEnergyDelta).toBeLessThan(calmEnergyDelta);
	});

	it("a tribe with burstMult/burstCostMult at 1 (no-op, e.g. TRIBE_CONFIG) behaves exactly as a non-bursting tribe even while fleeing", () => {
		const weights = { separation: 0, alignment: 0, cohesion: 0 };
		const boid = makeBoid(
			{ x: 100, y: 100, z: 100, vx: 1000, vy: 0, vz: 0, lifespan: 100 },
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

		const [stepped] = stepBoids(
			[boid],
			0.1,
			WORLD_SIZE,
			[predator],
			undefined,
			[TRIBE_CONFIG],
		);
		const speed = Math.hypot(
			(stepped as BoidState).vx,
			(stepped as BoidState).vy,
			(stepped as BoidState).vz,
		);

		expect(speed).toBeCloseTo(boid.genes.maxSpeed, 5);
	});
});

describe("computeGeneticDiversity (S-04 FR-010 full — correctness fix)", () => {
	it("returns 0 for an empty population", () => {
		expect(computeGeneticDiversity([])).toBe(0);
	});

	it("returns 0 when every individual has identical genes", () => {
		const genes = Array.from({ length: 5 }, () => makeGenes());
		expect(computeGeneticDiversity(genes)).toBe(0);
	});

	it("returns a higher value for a population with widely spread gene values than one with tightly clustered values", () => {
		const tight = [
			makeGenes(WEIGHTS, { maxSpeed: 40 }),
			makeGenes(WEIGHTS, { maxSpeed: 41 }),
			makeGenes(WEIGHTS, { maxSpeed: 39 }),
		];
		const spread = [
			makeGenes(WEIGHTS, { maxSpeed: 10 }),
			makeGenes(WEIGHTS, { maxSpeed: 80 }),
			makeGenes(WEIGHTS, { maxSpeed: 150 }),
		];

		expect(computeGeneticDiversity(spread)).toBeGreaterThan(
			computeGeneticDiversity(tight),
		);
	});

	it("does not read computeCohesion's spatial-clustering concept at all — same genes at different positions still reads 0 diversity", () => {
		// Regression guard for the S-01/S-03 mislabeling this fix corrects:
		// genetic diversity must depend only on genes, never on position.
		const genes = makeGenes();
		expect(computeGeneticDiversity([genes, genes, genes])).toBe(0);
	});

	// per-tribe-behavior-weights Phase 7: neighborRadius/separationRadius/
	// predatorDetectionRadius/burstMult/burstCostMult are TRIBE-level config
	// (tribeConfigs[flockId]), not per-boid BoidGenes fields (Phase 3/4/6's
	// confirmed design) — so this dimension is only visible when
	// tribeConfigs is passed as the second argument, and only varies when
	// boids actually belong to different tribes with different configs.
	it("reads tribe-level fields (e.g. neighborRadius) only via a passed tribeConfigs — a population split across tribes with identical weights but different neighborRadius scores higher than an otherwise-identical single-tribe population", () => {
		const singleTribeConfigs: TribeConfig[] = [TRIBE_CONFIG];
		const multiTribeConfigs: TribeConfig[] = [
			TRIBE_CONFIG,
			{ ...TRIBE_CONFIG, neighborRadius: 140 },
		];

		const singleTribeGenes = [
			makeGenes(WEIGHTS, { flockId: 0 }),
			makeGenes(WEIGHTS, { flockId: 0 }),
			makeGenes(WEIGHTS, { flockId: 0 }),
		];
		const multiTribeGenes = [
			makeGenes(WEIGHTS, { flockId: 0 }),
			makeGenes(WEIGHTS, { flockId: 1 }),
			makeGenes(WEIGHTS, { flockId: 1 }),
		];

		expect(
			computeGeneticDiversity(multiTribeGenes, multiTribeConfigs),
		).toBeGreaterThan(
			computeGeneticDiversity(singleTribeGenes, singleTribeConfigs),
		);
	});

	it("contributes 0 for the tribe-level dimension when tribeConfigs is omitted — legacy call sites without tribe config data never throw", () => {
		const genes = [
			makeGenes(WEIGHTS, { flockId: 0, maxSpeed: 10 }),
			makeGenes(WEIGHTS, { flockId: 1, maxSpeed: 90 }),
		];
		// Should not throw, and should equal the score computed with an
		// explicit empty tribeConfigs array (both treat tribe-level
		// diversity as 0).
		expect(computeGeneticDiversity(genes)).toBe(
			computeGeneticDiversity(genes, []),
		);
	});
});

describe("classifyPopulationPhase", () => {
	const WINDOW = 20;

	function sample(populationCount: number, foodAvailabilityRatio: number) {
		return { populationCount, foodAvailabilityRatio };
	}

	it("classifies as establishment when fewer than the window's worth of history exists", () => {
		const shortHistory = Array.from({ length: WINDOW - 1 }, () =>
			sample(50, 0.9),
		);
		expect(classifyPopulationPhase(shortHistory, null)).toBe("establishment");
	});

	it("classifies as establishment below the window even when the short history itself looks like a crash", () => {
		// Proves the length guard, not the decline pattern, controls the
		// result: this data shape would classify as "crash" at full window
		// size (see the crash case below), but at 5 samples it never reaches
		// that check.
		const shortDecliningHistory = Array.from({ length: 5 }, (_, i) =>
			sample(200 - i * 30, 0.1),
		);
		expect(classifyPopulationPhase(shortDecliningHistory, null)).toBe(
			"establishment",
		);
	});

	it("classifies as growth when population is rising and food is abundant", () => {
		const history = Array.from({ length: WINDOW }, (_, i) =>
			sample(50 + i * 5, 0.9),
		);
		expect(classifyPopulationPhase(history, null)).toBe("growth");
	});

	it("classifies as overshoot when population is elevated but food is scarce, without a sharp decline yet", () => {
		const history = Array.from({ length: WINDOW }, () => sample(200, 0.1));
		expect(classifyPopulationPhase(history, null)).toBe("overshoot");
	});

	it("classifies as crash when population is sharply declining alongside scarce food", () => {
		const history = Array.from({ length: WINDOW }, (_, i) =>
			sample(200 - i * 10, 0.1),
		);
		expect(classifyPopulationPhase(history, null)).toBe("crash");
	});

	it("classifies as recovery only when the previous phase was crash and population is no longer declining", () => {
		const recoveringHistory = Array.from({ length: WINDOW }, (_, i) =>
			sample(50 + i, 0.5),
		);
		expect(classifyPopulationPhase(recoveringHistory, "crash")).toBe(
			"recovery",
		);

		// The same rising population, with no prior crash, is just growth —
		// recovery is only reachable from crash.
		expect(classifyPopulationPhase(recoveringHistory, "growth")).toBe("growth");
		expect(classifyPopulationPhase(recoveringHistory, null)).toBe("growth");
	});
});

describe("computeResourceManagement", () => {
	it("returns 0 for no samples", () => {
		expect(computeResourceManagement([])).toBe(0);
	});

	it("averages the food-availability-ratio samples", () => {
		expect(computeResourceManagement([0, 1])).toBe(0.5);
	});
});

// S-11 (MS-08): exposes the tick ranges `countCrashToRecoveryCycles`
// (tested indirectly via computePhaseQuality above) only counts.
describe("segmentCompletedCycles", () => {
	it("returns an empty array for a history with no completed cycle", () => {
		const allCrash: PopulationPhase[] = Array(5).fill("crash");
		expect(segmentCompletedCycles(allCrash)).toEqual([]);
	});

	it("returns the correct tick range for a single completed cycle", () => {
		const oneCycle: PopulationPhase[] = [
			"growth",
			"growth",
			...Array(3).fill("crash"),
			...Array(2).fill("recovery"),
		];
		// crash starts at index 2, the first recovery is at index 5.
		expect(segmentCompletedCycles(oneCycle)).toEqual([
			{ startTick: 2, endTick: 5 },
		]);
	});

	it("returns one range per non-overlapping cycle, matching the count countCrashToRecoveryCycles derives from it", () => {
		const twoCycles: PopulationPhase[] = [
			"crash",
			"crash",
			"recovery",
			"recovery",
			"crash",
			"crash",
			"crash",
			"recovery",
			"recovery",
			"recovery",
		];
		const result = segmentCompletedCycles(twoCycles);
		expect(result).toEqual([
			{ startTick: 0, endTick: 2 },
			{ startTick: 4, endTick: 7 },
		]);
		// Same input computePhaseQuality's resilience-bonus test (above)
		// already proves scores as "2 cycles" via the count this wraps.
		expect(result).toHaveLength(2);
	});
});

describe("computePhaseQuality", () => {
	it("returns 0 for an empty phase history", () => {
		expect(computePhaseQuality([])).toBe(0);
	});

	it("scores a run that stays in growth higher than one that stays in crash", () => {
		const allGrowth: PopulationPhase[] = Array(10).fill("growth");
		const allCrash: PopulationPhase[] = Array(10).fill("crash");

		expect(computePhaseQuality(allGrowth)).toBeGreaterThan(
			computePhaseQuality(allCrash),
		);
	});

	it("rewards a genuine crash-then-recovery run above a crash-only run of the same length (resilience bonus)", () => {
		const crashOnly: PopulationPhase[] = Array(10).fill("crash");
		const crashThenRecovery: PopulationPhase[] = [
			...Array(5).fill("crash"),
			...Array(5).fill("recovery"),
		];

		expect(computePhaseQuality(crashThenRecovery)).toBeGreaterThan(
			computePhaseQuality(crashOnly),
		);
	});

	it("never exceeds 1 even with the resilience bonus applied", () => {
		const allGrowthThenRecovery: PopulationPhase[] = [
			"crash",
			...Array(20).fill("recovery"),
		];
		expect(computePhaseQuality(allGrowthThenRecovery)).toBeLessThanOrEqual(1);
	});

	// S-09 (roadmap MS-06): the resilience bonus must scale with the number
	// of completed cycles, not just whether at least one exists — this is
	// the actual gap the previous boolean-only `hasCrashToRecovery` scan had.
	it("rewards two completed crash-to-recovery cycles above exactly one, at the same flat phase-weight average", () => {
		const oneCycle: PopulationPhase[] = [
			...Array(5).fill("crash"),
			...Array(5).fill("recovery"),
		];
		const twoCycles: PopulationPhase[] = [
			"crash",
			"crash",
			"recovery",
			"recovery",
			"crash",
			"crash",
			"crash",
			"recovery",
			"recovery",
			"recovery",
		];

		// Same composition (5 crash + 5 recovery ticks either way), so the
		// flat time-weighted average term is identical — any score
		// difference comes entirely from the resilience bonus.
		expect(computePhaseQuality(twoCycles)).toBeGreaterThan(
			computePhaseQuality(oneCycle),
		);
	});

	it("caps the resilience bonus at RESILIENCE_BONUS_CAP_CYCLES completed cycles", () => {
		const threeCycles: PopulationPhase[] = Array(3)
			.fill(["crash", "recovery"])
			.flat();
		const fourCycles: PopulationPhase[] = Array(4)
			.fill(["crash", "recovery"])
			.flat();

		// Every crash/recovery pair contributes the same per-pair average
		// regardless of pair count, so both arrays score identically once
		// the cap is reached — proving the 4th cycle adds no further bonus.
		expect(computePhaseQuality(fourCycles)).toBe(
			computePhaseQuality(threeCycles),
		);
	});
});

describe("computeScore", () => {
	it("increases monotonically with elapsedTicks, holding every other factor fixed", () => {
		expect(computeScore(20, 0.8, 0.8, 0.8, 1)).toBeGreaterThan(
			computeScore(10, 0.8, 0.8, 0.8, 1),
		);
	});

	it("increases monotonically with resourceManagement, holding every other factor fixed", () => {
		expect(computeScore(10, 0.9, 0.8, 0.8, 1)).toBeGreaterThan(
			computeScore(10, 0.2, 0.8, 0.8, 1),
		);
	});

	it("increases monotonically with geneticDiversity, holding every other factor fixed", () => {
		expect(computeScore(10, 0.8, 0.9, 0.8, 1)).toBeGreaterThan(
			computeScore(10, 0.8, 0.2, 0.8, 1),
		);
	});

	it("increases monotonically with phaseQuality, holding every other factor fixed", () => {
		expect(computeScore(10, 0.8, 0.8, 0.9, 1)).toBeGreaterThan(
			computeScore(10, 0.8, 0.8, 0.2, 1),
		);
	});

	it("increases monotonically with areaPopulationDensity, holding every other factor fixed", () => {
		expect(computeScore(10, 0.8, 0.8, 0.8, 0.9)).toBeGreaterThan(
			computeScore(10, 0.8, 0.8, 0.8, 0.2),
		);
	});

	it("is 0 when any single factor is 0 (true product, not a sum)", () => {
		expect(computeScore(10, 0, 0.8, 0.8, 1)).toBe(0);
		expect(computeScore(10, 0.8, 0, 0.8, 1)).toBe(0);
		expect(computeScore(10, 0.8, 0.8, 0, 1)).toBe(0);
		expect(computeScore(10, 0.8, 0.8, 0.8, 0)).toBe(0);
	});
});

// Phase 2 (spatial-grid-dense-clustering-fallback): proves the warn-sink
// threaded through stepBoids/applyPredation/reproducePopulation's own
// queryRadius calls, and that runTick surfaces a combined signal. A dense
// cluster here means "more than DENSE_CLUSTER_CANDIDATE_CAP (64) items in
// one query's candidate set" — colocating every individual at the same
// point guarantees that regardless of exact count, so a population well
// above 64 (not literally 10,000+) is enough to trigger the cap
// deterministically without the O(n^2) query cost a much larger count would
// add to this suite.
describe("dense-cluster warn-sink (Phase 2)", () => {
	const DENSE_COUNT = 80;

	function makeDenseBoids(count: number): BoidState[] {
		return Array.from({ length: count }, () =>
			makeBoid({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, lifespan: 1000 }),
		);
	}

	function makeDensePredators(count: number): PredatorState[] {
		return Array.from({ length: count }, () =>
			makePredator({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, lifespan: 1000 }),
		);
	}

	function makeDenseEligibleIndividuals(count: number): BoidState[] {
		return Array.from({ length: count }, (_, i) => ({
			x: 0,
			y: 0,
			z: 0,
			vx: 0,
			vy: 0,
			vz: 0,
			lifespan: 1000,
			genes: makeGenes(),
			energy: 100,
			age: MATURITY_AGE_SECONDS,
			gender: i % 2 === 0 ? "a" : "b",
		}));
	}

	it("stepBoids trips its own warn-sink when a dense boid-boid neighbor query is truncated", () => {
		const boids = makeDenseBoids(DENSE_COUNT);
		const warnSink: DenseClusterWarnSink = { triggered: false };

		stepBoids(boids, 0.1, WORLD_SIZE, [], warnSink);

		expect(warnSink.triggered).toBe(true);
	});

	it("stepBoids trips its own warn-sink when a dense boid-predator flee-detection query is truncated", () => {
		// A single boid with no boid neighbors of its own, but a dense cluster
		// of predators all within PREDATOR_DETECTION_RADIUS — isolates the
		// second (predator) queryRadius call from the first (boid-boid) one.
		const boid = makeDenseBoids(1);
		const predators = makeDensePredators(DENSE_COUNT);
		const warnSink: DenseClusterWarnSink = { triggered: false };

		stepBoids(boid, 0.1, WORLD_SIZE, predators, warnSink);

		expect(warnSink.triggered).toBe(true);
	});

	it("applyPredation trips its own warn-sink when a dense boid query is truncated", () => {
		const boids = makeDenseBoids(DENSE_COUNT);
		const predators = makeDensePredators(1);
		const warnSink: DenseClusterWarnSink = { triggered: false };

		applyPredation(boids, predators, 0, WORLD_SIZE, warnSink);

		expect(warnSink.triggered).toBe(true);
	});

	it("reproducePopulation trips its own warn-sink when a dense mate-scan query is truncated", () => {
		const population = makeDenseEligibleIndividuals(DENSE_COUNT);
		const warnSink: DenseClusterWarnSink = { triggered: false };

		reproducePopulation(
			population,
			createRng(1),
			{
				crossbreedingEnabled: true,
				energyThreshold: 50,
				mutationChance: 0,
				mutationMagnitude: 0.2,
				populationCap: 100_000,
				totalOtherPopulationCount: 0,
				warnSink,
			},
			WORLD_SIZE,
		);

		expect(warnSink.triggered).toBe(true);
	});

	it("runTick surfaces hasWarnedDenseClustering: true when any internal queryRadius call truncates", () => {
		const result = runTick(
			{
				boids: makeDenseBoids(DENSE_COUNT),
				predators: makeDensePredators(DENSE_COUNT),
				foodStock: 1000,
			},
			{
				dtSeconds: 0.1,
				foodRegenRate: 5,
				protectionThreshold: 0,
				rng: createRng(1),
				crossbreedingEnabled: true,
				energyThreshold: 1000, // unreachable this tick — isolates the signal to stepBoids/applyPredation, not reproduction.
				mutationChance: 0,
				mutationMagnitude: 0.2,
				populationCap: 100_000,
				foodStockInitial: 1000,
				worldSize: WORLD_SIZE,
				tribeConfigs: [TRIBE_CONFIG],
			},
		);

		expect(result.hasWarnedDenseClustering).toBe(true);
	});

	it("omitting warnSink leaves stepBoids/applyPredation/reproducePopulation behavior exactly as before (no tracking, no behavior change)", () => {
		const boids = makeDenseBoids(DENSE_COUNT);

		const withoutSink = stepBoids(boids, 0.1, WORLD_SIZE);
		const withUntriggeredSink = stepBoids(boids, 0.1, WORLD_SIZE, [], {
			triggered: false,
		});

		expect(withoutSink).toEqual(withUntriggeredSink);
	});

	it("runTick on normal-density existing fixtures reports hasWarnedDenseClustering: false and leaves every other field unchanged", () => {
		const boids = createInitialPopulation(
			10,
			createRng(1),
			100,
			1,
			[TRIBE_CONFIG],
			WORLD_SIZE,
		);
		const predators = createInitialPredators(
			2,
			createRng(2),
			100,
			1,
			[TRIBE_CONFIG],
			WORLD_SIZE,
		);
		const params = {
			dtSeconds: 0.1,
			foodRegenRate: 5,
			protectionThreshold: 0,
			rng: createRng(3),
			crossbreedingEnabled: true,
			energyThreshold: 50,
			mutationChance: 0.1,
			mutationMagnitude: 0.2,
			populationCap: 500,
			foodStockInitial: 20,
			worldSize: WORLD_SIZE,
			tribeConfigs: [TRIBE_CONFIG],
		};

		const a = runTick(
			{ boids, predators, foodStock: 20 },
			{ ...params, rng: createRng(3) },
		);
		const b = runTick(
			{ boids, predators, foodStock: 20 },
			{ ...params, rng: createRng(3) },
		);

		expect(a.hasWarnedDenseClustering).toBe(false);
		expect(a).toEqual(b);
	});
});

describe("computeAreaPopulationDensity", () => {
	it("returns 0 for an empty sample array", () => {
		expect(computeAreaPopulationDensity([])).toBe(0);
	});

	it("returns 1.0 average when density holds exactly constant", () => {
		expect(computeAreaPopulationDensity([0.5, 0.5, 0.5])).toBeCloseTo(1.0);
	});

	it("returns an average strictly below 1.0 when density declines over the run", () => {
		expect(computeAreaPopulationDensity([1, 0.5, 0.25])).toBeLessThan(1.0);
		expect(computeAreaPopulationDensity([1, 0.5, 0.25])).toBeGreaterThan(0);
	});

	it("returns 0 when the initial sample is 0 (empty starting population)", () => {
		expect(computeAreaPopulationDensity([0, 0.5, 0.8])).toBe(0);
	});
});
