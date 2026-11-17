// Reproducible wall-clock performance benchmark for `computeSingleRunTick`
// (rollout Phase 8, test-plan.md Risk #8 — see
// context/changes/testing-perf-baseline/{research,plan}.md).
//
// This file only constructs the grid and measures it (exports
// `runBenchmarkGrid`); it deliberately does no file I/O — Phase 2 wires the
// committed JSON/markdown output artifacts and the npm script around this
// function, per the plan's "keep construction/measurement and
// output-writing separable" contract.
//
// tinybench `iterations`/`time` semantics (verified against the installed
// tinybench@6.2.3 .d.ts/README, not assumed — the plan's own grounding note
// required this): in sequential mode, a task keeps running until BOTH its
// `time` budget AND its minimum `iterations` count are satisfied. `time` is
// a *budget it must also reach*, not a ceiling — so the plan's suggested
// `time: Number.POSITIVE_INFINITY` would never be satisfied and the run
// would hang forever. The README states the actual mechanism explicitly:
// "With `time: 0`, the run can finish at the minimum iteration count." So
// `{ iterations: N, time: 0 }` is what gives exactly N deterministic
// samples, not `time: Infinity`.
//
// Imports use the project's `~/*` tsconfig alias — confirmed (impl-review
// F3, 2026-11-17) that `tsx` (Phase 2's chosen runner) resolves it
// correctly both from this directory and from an arbitrary cwd, matching
// the rest of the codebase's import convention rather than deviating from
// it.
import { Bench } from "tinybench";
import {
	type BoidState,
	createInitialPopulation,
	createInitialPredators,
	type PopulationPhase,
	type PredatorState,
	type WorldSize,
} from "~/server/simulation/boids";
import { createRng } from "~/server/simulation/rng";
import { computeSingleRunTick } from "~/server/simulation/single-run-lifecycle";

// --- Grid definition -------------------------------------------------------

export const OBJECT_COUNTS = [100, 200, 300, 400, 500, 1000] as const;
export const AREA_SIZES = [200, 400, 1000] as const;
export const CONCURRENT_RUN_COUNTS = [1, 2, 4] as const;

// Reuses pipeline-perf.test.ts's confirmed 4:1 boid:predator ratio (its
// `buildState(40, 10)` / `buildState(160, 40)` samples — both exactly 80%
// boids / 20% predators) rather than inventing a new split. This also
// matches capacity-limits.md's "combined population" counts (100..500),
// which were measured at the same ratio per that change's research.
const BOID_SHARE = 0.8;

function splitObjectCount(objectCount: number): {
	boidCount: number;
	predatorCount: number;
} {
	const boidCount = Math.round(objectCount * BOID_SHARE);
	return { boidCount, predatorCount: objectCount - boidCount };
}

// Same fixed single-flock weights/params convention as
// pipeline-perf.test.ts's BASE_PARAMS/WEIGHTS — this benchmark targets
// computeSingleRunTick's per-tick cost, not flock-weight variation, so it
// reuses the existing confirmed-safe constants rather than inventing new
// ones (see that file's comments on why protectionThreshold: 0 and a
// generous food stock are load-bearing for a stable scan shape).
const WEIGHTS = { separation: 1, alignment: 1, cohesion: 1 };
const MAX_LIFESPAN = 100;
const FLOCK_COUNT = 1;

const TICK_PARAMS_BASE = {
	foodRegenRate: 10,
	protectionThreshold: 0,
	crossbreedingEnabled: true,
	energyThreshold: 50,
	mutationChance: 0.1,
	mutationMagnitude: 0.2,
	foodStockInitial: 1000,
	// Large enough that `shouldStop` from elapsed duration never trips
	// across a sample's tick budget; irrelevant to this benchmark either
	// way since the measured loop ignores `shouldStop` and keeps ticking
	// (a benchmark fixture, not a real run lifecycle).
	maxDurationSeconds: Number.POSITIVE_INFINITY,
};

// Fixed total ticks measured per sample, round-robin across the
// configuration's concurrent-run count. Kept well below the ~225,000-tick
// scale that `scripts/corpus/harness.test.ts` notes as exceeding a 2-minute
// timeout (research.md) — this is a per-tick cost probe, not an endurance
// run — while still large enough that one-time population-construction
// cost (see below) stays a small fraction of each sample's measured time.
const TOTAL_TICKS_PER_SAMPLE = 50;

const ITERATIONS_PER_CONFIG = 8;

type TickState = Parameters<typeof computeSingleRunTick>[0];
type TickParams = Parameters<typeof computeSingleRunTick>[2];

// One independent simulation state, matching computeSingleRunTick's full
// input shape (not just boids/predators/foodStock) — same construction
// pattern as pipeline-perf.test.ts's `buildState`, extended with the
// sample-array/history/timestamp fields computeSingleRunTick also threads.
function createTickState(
	objectCount: number,
	area: number,
	seedOffset: number,
): { state: TickState; params: TickParams } {
	const { boidCount, predatorCount } = splitObjectCount(objectCount);
	const worldSize: WorldSize = { x: area, y: area, z: area };

	const boids: BoidState[] = createInitialPopulation(
		boidCount,
		createRng(1 + seedOffset),
		MAX_LIFESPAN,
		FLOCK_COUNT,
		[WEIGHTS],
		worldSize,
	);
	const predators: PredatorState[] = createInitialPredators(
		predatorCount,
		createRng(2 + seedOffset),
		MAX_LIFESPAN,
		FLOCK_COUNT,
		[WEIGHTS],
		worldSize,
	);

	const state: TickState = {
		boids,
		predators,
		foodStock: TICK_PARAMS_BASE.foodStockInitial,
		cohesionSamples: [],
		foodRatioSamples: [],
		populationCountSamples: [],
		populationDensitySamples: [],
		geneticDiversitySamples: [],
		phaseHistory: [] as PopulationPhase[],
		elapsedSeconds: 0,
		lastTimestamp: null,
		hasWarnedDenseClustering: false,
	};

	const params: TickParams = {
		...TICK_PARAMS_BASE,
		rng: createRng(99 + seedOffset),
		worldSize,
	};

	return { state, params };
}

// Advances `concurrentRuns` independent states by one tick each,
// round-robin, for TOTAL_TICKS_PER_SAMPLE total ticks — a single-process
// interleaving standing in for N concurrently-ticking server-owned runs
// sharing one CPU core, never the real setInterval/registry scheduler (that
// is Phase 9's job, per the plan's "What We're NOT Doing").
//
// Each measured iteration constructs fresh states rather than continuing a
// previous iteration's population: computeSingleRunTick's population can
// grow or shrink (reproduction, starvation) tick over tick, and letting 8
// samples share one continuously-evolving population would confound "cost
// at N objects" with "cost at whatever population size tick-driven drift
// happened to reach by then" — the opposite of reproducible. Construction
// cost itself is a tiny, fixed per-iteration overhead (plain array fills,
// no tick logic) relative to TOTAL_TICKS_PER_SAMPLE ticks of real pipeline
// work, so folding it into the measured iteration does not materially
// distort the per-tick signal.
function runInterleavedTicks(
	objectCount: number,
	area: number,
	concurrentRuns: number,
): void {
	const runs = Array.from({ length: concurrentRuns }, (_, i) =>
		createTickState(objectCount, area, i),
	);
	// Per-state virtual clock, advanced only when that state's turn comes
	// up — not a single shared clock across all N states — so each state
	// sees the same fixed dtSeconds-per-own-tick (10ms) regardless of how
	// many other states round-robin between its turns, matching a
	// regular, undisturbed per-run tick cadence.
	const timestampsMs = new Array<number>(concurrentRuns).fill(0);

	for (let tick = 0; tick < TOTAL_TICKS_PER_SAMPLE; tick++) {
		const i = tick % concurrentRuns;
		const run = runs[i];
		if (!run) {
			continue;
		}
		timestampsMs[i] = (timestampsMs[i] ?? 0) + 10; // fixed 10ms dt per own-tick
		const nextState = computeSingleRunTick(
			run.state,
			timestampsMs[i] ?? 0,
			run.params,
		);
		runs[i] = { state: nextState, params: run.params };
	}
}

// --- Measurement -------------------------------------------------------

export interface GridConfig {
	objectCount: number;
	area: number;
	concurrentRuns: number;
}

export interface GridResult extends GridConfig {
	meanMs: number;
	stdDevMs: number;
	samples: number;
}

export interface BenchmarkGridOptions {
	objectCounts?: readonly number[];
	areaSizes?: readonly number[];
	concurrentRunCounts?: readonly number[];
}

function buildGridConfigs(options?: BenchmarkGridOptions): GridConfig[] {
	const objectCounts = options?.objectCounts ?? OBJECT_COUNTS;
	const areaSizes = options?.areaSizes ?? AREA_SIZES;
	const concurrentRunCounts =
		options?.concurrentRunCounts ?? CONCURRENT_RUN_COUNTS;

	const configs: GridConfig[] = [];
	for (const objectCount of objectCounts) {
		for (const area of areaSizes) {
			for (const concurrentRuns of concurrentRunCounts) {
				configs.push({ objectCount, area, concurrentRuns });
			}
		}
	}
	return configs;
}

// Runs the full grid (54 configurations by default) through tinybench at
// N=8 iterations each, returning per-configuration timing statistics.
// Measurement only — no file I/O; see this file's header comment.
export async function runBenchmarkGrid(
	options?: BenchmarkGridOptions,
): Promise<GridResult[]> {
	const configs = buildGridConfigs(options);
	const results: GridResult[] = [];

	for (const config of configs) {
		const bench = new Bench({
			iterations: ITERATIONS_PER_CONFIG,
			// See header comment: 0, not Number.POSITIVE_INFINITY — tinybench
			// treats `time` as a budget that must ALSO be satisfied, and an
			// infinite budget never is. `time: 0` is tinybench's own
			// documented way to make `iterations` the only limit.
			time: 0,
			warmup: false,
		});
		bench.add("interleaved-ticks", () => {
			runInterleavedTicks(
				config.objectCount,
				config.area,
				config.concurrentRuns,
			);
		});
		await bench.run();

		const task = bench.tasks[0];
		const result = task?.result;
		if (result?.state !== "completed") {
			throw new Error(
				`tinybench did not complete for config ${JSON.stringify(config)}: state=${result?.state ?? "none"}`,
			);
		}

		results.push({
			...config,
			meanMs: result.latency.mean,
			stdDevMs: result.latency.sd,
			samples: ITERATIONS_PER_CONFIG,
		});
	}

	return results;
}

// Minimal direct-invocation entry point for development smoke-testing
// (confirming the script runs end-to-end on a tiny trial grid) — Phase 2
// owns the real output-writing npm script and will extend or replace this
// guard accordingly.
const isMainModule = process.argv[1]
	? import.meta.url === new URL(process.argv[1], "file://").href
	: false;
if (isMainModule) {
	runBenchmarkGrid()
		.then((results) => {
			console.table(results);
		})
		.catch((error: unknown) => {
			console.error(error);
			process.exitCode = 1;
		});
}
