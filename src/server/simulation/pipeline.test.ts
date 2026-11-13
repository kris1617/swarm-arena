import { describe, expect, it } from "vitest";

import {
	applyHunger,
	applyPredation,
	type BoidGenes,
	type BoidState,
	createInitialPopulation,
	createInitialPredators,
	type PredatorState,
	runTick,
} from "~/server/simulation/boids";
import { createRng } from "~/server/simulation/rng";

const WEIGHTS = { separation: 1, alignment: 1, cohesion: 1 };
const PARAMS = {
	dtSeconds: 0.1,
	foodRegenRate: 5,
	protectionThreshold: 0,
	rng: createRng(99),
	crossbreedingEnabled: true,
	energyThreshold: 50,
	mutationChance: 0.1,
	mutationMagnitude: 0.2,
	populationCap: 500,
	foodStockInitial: 20,
};

// Minimal placeholder genes for raw BoidState/PredatorState literals in this
// file — these tests exercise applyHunger/applyPredation/runTick's own
// composition, not steering, so the exact gene values don't matter beyond
// satisfying the type.
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
	genesOverrides: Partial<BoidGenes> = {},
): BoidState {
	return {
		...state,
		genes: makeGenes(genesOverrides),
		energy: 0,
		age: 0,
		gender: "a",
	};
}

function makePredator(
	state: Pick<PredatorState, "x" | "y" | "z" | "vx" | "vy" | "vz" | "lifespan">,
	genesOverrides: Partial<BoidGenes> = {},
): PredatorState {
	return {
		...state,
		genes: makeGenes(genesOverrides),
		energy: 0,
		age: 0,
		gender: "a",
	};
}

describe("runTick", () => {
	it("is deterministic end-to-end across the full composed pipeline, not just the RNG primitive", () => {
		// Two independently-constructed but identical initial states (same
		// seed-derived boid/predator arrays, same params) — the oracle is
		// "two runs from identical input produce identical output", the same
		// run-twice-compare pattern already used in boids.test.ts/rng.test.ts,
		// not a hand-computed expected value.
		function buildState() {
			return {
				boids: createInitialPopulation(10, createRng(1), 100, 1, [WEIGHTS]),
				predators: createInitialPredators(3, createRng(2), 100, 1, [WEIGHTS]),
				foodStock: 20,
			};
		}

		function runTicks(
			initial: ReturnType<typeof buildState>,
			rng: () => number,
		) {
			let state = initial;
			for (let i = 0; i < 20; i++) {
				state = runTick(state, { ...PARAMS, rng });
			}
			return state;
		}

		// Two independent rng *instances* from the same seed — reusing one rng
		// object across both calls would advance its state between them and
		// falsely look non-deterministic.
		const a = runTicks(buildState(), createRng(99));
		const b = runTicks(buildState(), createRng(99));

		expect(a).toEqual(b);
	});
});

describe("applyPredation tie-break contract", () => {
	it("captures the first boid in the input array when two boids are equidistant from a predator", () => {
		// Predator at the origin; both boids sit exactly CAPTURE_RADIUS-3 away
		// (well within CAPTURE_RADIUS=6) at the same distance from it. The
		// documented scan rule is a strict `<` on distance, so the
		// first-encountered boid at the minimum distance wins the tie — this
		// fixture is constructed to exercise that exact rule, not copied from
		// running the function first.
		const first: BoidState = makeBoid({
			x: 3,
			y: 0,
			z: 0,
			vx: 0,
			vy: 0,
			vz: 0,
			lifespan: 100,
		});
		const second: BoidState = makeBoid({
			x: 0,
			y: 3,
			z: 0,
			vx: 0,
			vy: 0,
			vz: 0,
			lifespan: 100,
		});
		const predator: PredatorState = makePredator({
			x: 0,
			y: 0,
			z: 0,
			vx: 0,
			vy: 0,
			vz: 0,
			lifespan: 100,
		});

		const result = applyPredation([first, second], [predator], 0);

		expect(result).toHaveLength(1);
		expect(result[0]).toBe(second);
	});
});

describe("applyPredation contested capture", () => {
	it("removes exactly one boid when two predators are both in range of the one shared target", () => {
		// The shared boid is the only target in CAPTURE_RADIUS range for
		// either predator; a bystander boid sits far away from both. This
		// locks in the `captured` Set's single-claim invariant: with two
		// predators contesting one target, exactly one boid is removed — not
		// zero, not two, and no error.
		const target: BoidState = makeBoid({
			x: 0,
			y: 0,
			z: 0,
			vx: 0,
			vy: 0,
			vz: 0,
			lifespan: 100,
		});
		const bystander: BoidState = makeBoid({
			x: 100,
			y: 100,
			z: 100,
			vx: 0,
			vy: 0,
			vz: 0,
			lifespan: 100,
		});
		const predatorA: PredatorState = makePredator({
			x: 2,
			y: 0,
			z: 0,
			vx: 0,
			vy: 0,
			vz: 0,
			lifespan: 100,
		});
		const predatorB: PredatorState = makePredator({
			x: 0,
			y: 2,
			z: 0,
			vx: 0,
			vy: 0,
			vz: 0,
			lifespan: 100,
		});

		const result = applyPredation(
			[target, bystander],
			[predatorA, predatorB],
			0,
		);

		expect(result).toHaveLength(1);
		expect(result[0]).toBe(bystander);
	});
});

describe("hunger-before-predation order is load-bearing", () => {
	it("produces a measurably different outcome depending on which step runs first", () => {
		// `target` is constructed to reach lifespan exactly 0 from
		// applyHunger's extra decay this tick (HUNGER_EXTRA_DECAY_RATE=1,
		// dtSeconds=1, starting lifespan=1) while also sitting within
		// CAPTURE_RADIUS of `predator` (distance 3 <= 6), which is above the
		// protection threshold. `bystander` is far from the predator and has
		// a long lifespan, so it survives either order and only dilutes the
		// flock size past the protection threshold.
		const buildTarget = (): BoidState =>
			makeBoid({
				x: 3,
				y: 0,
				z: 0,
				vx: 0,
				vy: 0,
				vz: 0,
				lifespan: 1,
			});
		const buildBystander = (): BoidState =>
			makeBoid({
				x: 100,
				y: 100,
				z: 100,
				vx: 0,
				vy: 0,
				vz: 0,
				lifespan: 1000,
			});
		const predator: PredatorState = makePredator({
			x: 0,
			y: 0,
			z: 0,
			vx: 0,
			vy: 0,
			vz: 0,
			lifespan: 1000,
		});
		const foodStock = -10;
		const dtSeconds = 1;
		const foodRegenRate = 0;
		const protectionThreshold = 1;

		// Documented order: applyHunger then applyPredation.
		const hungerFirst = applyHunger(
			[buildTarget(), buildBystander()],
			foodStock,
			dtSeconds,
			foodRegenRate,
		);
		// The target is already gone right after the hunger step — its
		// lifespan hit exactly 0 here, before predation ever ran. This is
		// starvation, not predation.
		expect(hungerFirst.boids).toHaveLength(1);
		expect(hungerFirst.boids[0]?.x).toBe(100);

		const afterDocumentedOrder = applyPredation(
			hungerFirst.boids,
			[predator],
			protectionThreshold,
		);
		expect(afterDocumentedOrder).toHaveLength(1);
		expect(afterDocumentedOrder[0]?.x).toBe(100);

		// Swapped order: applyPredation then applyHunger, on a fresh copy of
		// the same input.
		const predationFirst = applyPredation(
			[buildTarget(), buildBystander()],
			[predator],
			protectionThreshold,
		);
		// The target's lifespan was still 1 (> 0) going into this call, so
		// its removal here can only be the CAPTURE_RADIUS proximity check —
		// it is captured, not starved.
		expect(predationFirst).toHaveLength(1);
		expect(predationFirst[0]?.x).toBe(100);

		const afterSwappedOrder = applyHunger(
			predationFirst,
			foodStock,
			dtSeconds,
			foodRegenRate,
		);
		expect(afterSwappedOrder.boids).toHaveLength(1);
		expect(afterSwappedOrder.boids[0]?.x).toBe(100);

		// The order genuinely changes more than just which function removed
		// the target: foodStock after the documented order reflects hunger
		// depleting against a flock of 2 (target still present), while the
		// swapped order's hunger step depletes against a flock of 1 (target
		// already captured) — a measurably different result for the same
		// input.
		expect(hungerFirst.foodStock).not.toBe(afterSwappedOrder.foodStock);
		expect(hungerFirst.foodStock).toBe(-11);
		expect(afterSwappedOrder.foodStock).toBe(-10.5);
	});
});

describe("runTick itself honors the hunger-before-predation order", () => {
	it("starves the target via runTick's own internal composition, not via a hand-rolled call sequence", () => {
		// The test above proves the *principle* that order matters by calling
		// applyHunger/applyPredation directly in each order — it never calls
		// runTick itself, so a future edit that swaps the two calls *inside*
		// runTick's own body would pass every other test in this file
		// undetected (the determinism test only checks runTick agrees with
		// itself, regardless of its internal order). This test closes that
		// gap: it drives the same starvation-vs-capture race through runTick,
		// with an oracle derived independently from the documented order and
		// the engine's own constants (FOOD_CONSUMPTION_PER_BOID=0.5,
		// HUNGER_EXTRA_DECAY_RATE=1), not copied from running runTick first.
		//
		// `dtSeconds` is tiny (0.01) so stepBoids'/stepPredators' movement
		// this tick stays small relative to CAPTURE_RADIUS (6) and the
		// target's starting distance from the predator (3) — the capture
		// condition survives the one tick of movement runTick applies before
		// hunger/predation ever run. Zero FlockWeights isolate steering to
		// only the fixed-constant flee force, keeping the movement math
		// tractable by hand.
		// Zero steering weights on both boids isolate movement to the fixed-
		// constant flee force only (runTick's params.weights is no longer read
		// by stepBoids — each boid's own genes drive steering now), keeping
		// the movement math tractable by hand.
		const zeroWeightGenes: Partial<BoidGenes> = {
			separationWeight: 0,
			alignmentWeight: 0,
			cohesionWeight: 0,
		};
		const target: BoidState = makeBoid(
			{
				x: 3,
				y: 0,
				z: 0,
				vx: 0,
				vy: 0,
				vz: 0,
				// Reaches exactly 0 after stepBoids' unconditional per-tick decay
				// (dtSeconds=0.01) plus applyHunger's extra decay
				// (HUNGER_EXTRA_DECAY_RATE=1 * dtSeconds=0.01) — starvation, iff
				// hunger runs before predation can act on the still-alive target.
				lifespan: 0.02,
			},
			zeroWeightGenes,
		);
		const bystander: BoidState = makeBoid(
			{
				x: 100,
				y: 100,
				z: 100,
				vx: 0,
				vy: 0,
				vz: 0,
				lifespan: 1000,
			},
			zeroWeightGenes,
		);
		const predator: PredatorState = makePredator({
			x: 0,
			y: 0,
			z: 0,
			vx: 0,
			vy: 0,
			vz: 0,
			lifespan: 1000,
		});

		const result = runTick(
			{ boids: [target, bystander], predators: [predator], foodStock: -1 },
			{
				dtSeconds: 0.01,
				foodRegenRate: 0,
				// 2 boids > threshold, so predation is reachable this tick if
				// the target is still alive when applyPredation runs.
				protectionThreshold: 1,
				// Reproduction is unreachable regardless of these values: every
				// individual's age starts at 0 and only bumps by dtSeconds=0.01
				// this tick, far short of MATURITY_AGE_SECONDS (5) — so these are
				// inert placeholders, not asserted on.
				rng: createRng(1),
				crossbreedingEnabled: true,
				energyThreshold: 50,
				mutationChance: 0.1,
				mutationMagnitude: 0.2,
				populationCap: 500,
				foodStockInitial: 20,
			},
		);

		// Under the documented order, hunger removes the target before
		// predation ever sees it — only the bystander (lifespan ~999.98)
		// survives. If runTick's internal order were ever swapped, predation
		// would capture the target while its lifespan was still > 0, and
		// foodStock below would reflect hunger depleting against 1 boid
		// instead of 2 (-1.005 instead of -1.01) — this assertion would fail
		// either way.
		expect(result.boids).toHaveLength(1);
		expect(result.boids[0]?.lifespan).toBeCloseTo(999.98, 2);
		expect(result.foodStock).toBeCloseTo(-1.01, 5);
	});
});
