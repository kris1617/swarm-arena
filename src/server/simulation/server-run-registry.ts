import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";

import { db } from "~/server/db";
import { simulationRuns } from "~/server/db/schema";
import {
	type BoidGenes,
	type BoidState,
	computeGeneticDiversity,
	computePhaseQuality,
	computeResourceManagement,
	computeScore,
	createInitialPopulation,
	createInitialPredators,
	type FlockWeights,
	type PopulationPhase,
	type PredatorState,
} from "~/server/simulation/boids";
import { createRng, type Rng } from "~/server/simulation/rng";
import { computeSingleRunTick } from "~/server/simulation/single-run-lifecycle";

// Same cadence the client's RAF loop approximates (~60fps) — keeps
// `elapsedSeconds` meaning wall-clock seconds, same as the client-driven
// staging path, rather than introducing a "simulation speed" concept.
const TICK_INTERVAL_MS = 16;

// Coarser than TICK_INTERVAL_MS — a human watching a canvas doesn't need
// 60fps state pushes, and a coarser cadence means far less serialization
// work per viewer (F-04).
const WATCH_INTERVAL_MS = 150;

export type ServerRunParams = {
	runId: number;
	seed: number;
	boidCount: number;
	separationWeight: number;
	alignmentWeight: number;
	cohesionWeight: number;
	maxDurationSeconds: number;
	predatorCount: number;
	protectionThreshold: number;
	foodStockInitial: number;
	foodRegenRate: number;
	flockCount: number;
	crossbreedingEnabled: boolean;
	energyThreshold: number;
	mutationChance: number;
	mutationMagnitude: number;
};

type LiveRun = {
	params: ServerRunParams;
	rng: Rng;
	boids: BoidState[];
	predators: PredatorState[];
	foodStock: number;
	cohesionSamples: number[];
	foodRatioSamples: number[];
	populationCountSamples: number[];
	phaseHistory: PopulationPhase[];
	elapsedSeconds: number;
	lastTimestamp: number | null;
	populationCapped: boolean;
	intervalId: ReturnType<typeof setInterval>;
};

// Cached on globalThis so the registry survives dev HMR, same pattern as
// `src/server/db/index.ts`'s `db` client caching — a fresh Map on every
// module reload would silently orphan every live interval's closure over
// the old Map.
const globalForRegistry = globalThis as unknown as {
	serverRunRegistry: Map<number, LiveRun> | undefined;
};

const registry: Map<number, LiveRun> =
	globalForRegistry.serverRunRegistry ?? new Map();
if (process.env.NODE_ENV !== "production") {
	globalForRegistry.serverRunRegistry = registry;
}

export type LiveRunSnapshot = {
	boids: BoidState[];
	predators: PredatorState[];
	elapsedSeconds: number;
	populationCapped: boolean;
};

export function getLiveRunState(runId: number): LiveRunSnapshot | undefined {
	const run = registry.get(runId);
	if (!run) {
		return undefined;
	}
	return {
		boids: run.boids,
		predators: run.predators,
		elapsedSeconds: run.elapsedSeconds,
		populationCapped: run.populationCapped,
	};
}

export function isServerRunActive(runId: number): boolean {
	return registry.has(runId);
}

async function finishRun(
	runId: number,
	outcome: {
		score: number | null;
		// F-05 (MS-08): omitted (defaults to null via `?? null`) on the
		// tick-error path, where the run's own state may be unreliable.
		history?: {
			phaseHistory: PopulationPhase[];
			foodRatioSamples: number[];
			survivorGenes: BoidGenes[];
			// S-11 (MS-08): the run-analysis-view's population-over-time chart
			// needs this time series — added alongside the other three.
			populationCountSamples: number[];
		} | null;
	},
): Promise<void> {
	const run = registry.get(runId);
	if (run) {
		clearInterval(run.intervalId);
		registry.delete(runId);
	}
	try {
		await db
			.update(simulationRuns)
			.set({
				status: "stopped",
				score: outcome.score,
				stoppedAt: new Date(),
				history: outcome.history ?? null,
			})
			.where(eq(simulationRuns.id, runId));
	} catch (error) {
		// This is called fire-and-forget (`void finishRun(...)`) from the tick
		// loop, so an uncaught rejection here would be an unhandled promise
		// rejection — potentially crashing the process. Catching and logging
		// loudly is this Foundation's minimal answer; the run is already
		// removed from the registry above (can't be un-removed without a
		// resumable-state mechanism, which is S-04's job, not this one), so a
		// failed write here leaves the row stuck at `status: "running"` with
		// no live run tracking it. That is a known, logged gap — not silently
		// swallowed — until S-04 adds real durability.
		console.error(
			`server run ${runId}: failed to write final status/score — row may be stuck at "running":`,
			error,
		);
	}
}

function tick(runId: number): void {
	const run = registry.get(runId);
	if (!run) {
		return;
	}

	try {
		const result = computeSingleRunTick(
			{
				boids: run.boids,
				predators: run.predators,
				foodStock: run.foodStock,
				cohesionSamples: run.cohesionSamples,
				foodRatioSamples: run.foodRatioSamples,
				populationCountSamples: run.populationCountSamples,
				phaseHistory: run.phaseHistory,
				elapsedSeconds: run.elapsedSeconds,
				lastTimestamp: run.lastTimestamp,
			},
			Date.now(),
			{
				foodRegenRate: run.params.foodRegenRate,
				protectionThreshold: run.params.protectionThreshold,
				maxDurationSeconds: run.params.maxDurationSeconds,
				foodStockInitial: run.params.foodStockInitial,
				rng: run.rng,
				crossbreedingEnabled: run.params.crossbreedingEnabled,
				energyThreshold: run.params.energyThreshold,
				mutationChance: run.params.mutationChance,
				mutationMagnitude: run.params.mutationMagnitude,
			},
		);

		run.boids = result.boids;
		run.predators = result.predators;
		run.foodStock = result.foodStock;
		run.cohesionSamples = result.cohesionSamples;
		run.foodRatioSamples = result.foodRatioSamples;
		run.populationCountSamples = result.populationCountSamples;
		run.phaseHistory = result.phaseHistory;
		run.elapsedSeconds = result.elapsedSeconds;
		run.lastTimestamp = result.lastTimestamp;
		run.populationCapped = result.populationCapped;

		if (result.shouldStop) {
			const score = computeScore(
				run.elapsedSeconds,
				computeResourceManagement(run.foodRatioSamples),
				computeGeneticDiversity(run.boids.map((b) => b.genes)),
				computePhaseQuality(run.phaseHistory),
			);
			void finishRun(runId, {
				score,
				history: {
					phaseHistory: run.phaseHistory,
					foodRatioSamples: run.foodRatioSamples,
					survivorGenes: run.boids.map((b) => b.genes),
					populationCountSamples: run.populationCountSamples,
				},
			});
		}
	} catch (error) {
		// Mirrors simulation-canvas.tsx's tick-error rule: the tick's own state
		// may be unreliable at this point, so stop and log rather than attempt
		// to score a broken run.
		console.error(`server run ${runId} tick failed:`, error);
		void finishRun(runId, { score: null });
	}
}

export function startServerRun(params: ServerRunParams): void {
	if (registry.has(params.runId)) {
		throw new Error(
			`server run ${params.runId} is already registered — startServerRun called twice for the same runId`,
		);
	}

	// Generous relative to maxDurationSeconds so natural lifespan decay
	// doesn't cut the run shorter than the duration the caller chose — same
	// derivation simulation-canvas.tsx's init effect uses.
	const maxLifespan = Math.max(60, params.maxDurationSeconds);
	const rng = createRng(params.seed);
	const flockWeights: FlockWeights[] = Array.from(
		{ length: params.flockCount },
		() => ({
			separation: params.separationWeight,
			alignment: params.alignmentWeight,
			cohesion: params.cohesionWeight,
		}),
	);

	const boids = createInitialPopulation(
		params.boidCount,
		rng,
		maxLifespan,
		params.flockCount,
		flockWeights,
	);
	const predators = createInitialPredators(
		params.predatorCount,
		rng,
		maxLifespan,
		params.flockCount,
		flockWeights,
	);

	const run: LiveRun = {
		params,
		rng,
		boids,
		predators,
		foodStock: params.foodStockInitial,
		cohesionSamples: [],
		foodRatioSamples: [],
		populationCountSamples: [],
		phaseHistory: [],
		elapsedSeconds: 0,
		lastTimestamp: null,
		populationCapped: false,
		intervalId: setInterval(() => tick(params.runId), TICK_INTERVAL_MS),
	};
	registry.set(params.runId, run);
}

// Returns a Promise (ADAPT from the plan's `stopServerRun(runId): void`
// contract) so a caller — a future tRPC mutation, or a test — can await the
// DB write actually landing rather than racing a fire-and-forget update.
// The "void" intent (manually stop a run, score it, no return value the
// caller must use) is unchanged; only the ability to await completion was
// added.
export async function stopServerRun(runId: number): Promise<void> {
	const run = registry.get(runId);
	if (!run) {
		// Idempotent: a caller racing a natural completion against a manual
		// stop should not throw.
		return;
	}
	const score = computeScore(
		run.elapsedSeconds,
		computeResourceManagement(run.foodRatioSamples),
		computeGeneticDiversity(run.boids.map((b) => b.genes)),
		computePhaseQuality(run.phaseHistory),
	);
	await finishRun(runId, {
		score,
		history: {
			phaseHistory: run.phaseHistory,
			foodRatioSamples: run.foodRatioSamples,
			survivorGenes: run.boids.map((b) => b.genes),
			populationCountSamples: run.populationCountSamples,
		},
	});
}

// S-04 Phase 4 (FR-012): everything needed to reconstruct an identical
// `LiveRun` later — persisted verbatim into `simulationRuns.savedState`.
export type ServerRunSnapshot = {
	params: ServerRunParams;
	rngState: number;
	boids: BoidState[];
	predators: PredatorState[];
	foodStock: number;
	cohesionSamples: number[];
	foodRatioSamples: number[];
	populationCountSamples: number[];
	phaseHistory: PopulationPhase[];
	elapsedSeconds: number;
	lastTimestamp: number | null;
	populationCapped: boolean;
};

// The pause half of save/resume: stops ticking and hands back everything
// `resumeServerRun` needs to continue from exactly this point — same
// registry cleanup `stopServerRun` does (clear interval, delete entry),
// but returns the live state instead of scoring/finishing the run.
export function snapshotServerRun(
	runId: number,
): ServerRunSnapshot | undefined {
	const run = registry.get(runId);
	if (!run) {
		return undefined;
	}
	clearInterval(run.intervalId);
	registry.delete(runId);
	return {
		params: run.params,
		rngState: run.rng.getState(),
		boids: run.boids,
		predators: run.predators,
		foodStock: run.foodStock,
		cohesionSamples: run.cohesionSamples,
		foodRatioSamples: run.foodRatioSamples,
		populationCountSamples: run.populationCountSamples,
		phaseHistory: run.phaseHistory,
		elapsedSeconds: run.elapsedSeconds,
		lastTimestamp: run.lastTimestamp,
		populationCapped: run.populationCapped,
	};
}

// The `startServerRun` counterpart: reconstructs a `LiveRun` directly from
// a snapshot's arrays/values — never re-generates the population — and
// restores the RNG to the exact point it was paused at, then resumes
// ticking exactly as `startServerRun` does.
export function resumeServerRun(
	runId: number,
	snapshot: ServerRunSnapshot,
): void {
	if (registry.has(runId)) {
		throw new Error(
			`server run ${runId} is already registered — resumeServerRun called for an already-active runId`,
		);
	}
	// impl-review (full-score-save-resume, F4): `createRng`'s seed argument
	// does no real work here — `setState` immediately below fully overwrites
	// whatever seed-derived state it produced. It's only needed because
	// `createRng` requires one to construct an `Rng` at all; don't "simplify"
	// this away thinking the seed alone is enough to resume correctly.
	const rng = createRng(snapshot.params.seed);
	rng.setState(snapshot.rngState);

	const run: LiveRun = {
		params: snapshot.params,
		rng,
		boids: snapshot.boids,
		predators: snapshot.predators,
		foodStock: snapshot.foodStock,
		cohesionSamples: snapshot.cohesionSamples,
		foodRatioSamples: snapshot.foodRatioSamples,
		populationCountSamples: snapshot.populationCountSamples,
		phaseHistory: snapshot.phaseHistory,
		elapsedSeconds: snapshot.elapsedSeconds,
		lastTimestamp: snapshot.lastTimestamp,
		populationCapped: snapshot.populationCapped,
		intervalId: setInterval(() => tick(runId), TICK_INTERVAL_MS),
	};
	registry.set(runId, run);
}

// Plain, exported async generator — the testable core of F-04's live view
// channel. Deliberately NOT a tRPC procedure: tRPC's own types forbid
// invoking a `.subscription()` procedure via `createCaller`
// (`.subscription(...)`'s return type is `TCaller extends true ? TypeError<'Not implemented'> : ...`),
// so this logic lives here as a plain function callable directly from
// tests, with the `simulationRouter.watch` procedure as a thin delegate
// that only adds tRPC's `tracked()` SSE envelope — a transport concern that
// has no place in this testable core.
export async function* watchServerRun(opts: {
	runId: number;
	userId: string;
	signal?: AbortSignal;
}): AsyncGenerator<LiveRunSnapshot, void, unknown> {
	const row = await db.query.simulationRuns.findFirst({
		where: (t, { eq: eqFn }) => eqFn(t.id, opts.runId),
	});
	if (!row) {
		throw new TRPCError({ code: "BAD_REQUEST" });
	}
	if (row.userId !== opts.userId) {
		throw new TRPCError({ code: "FORBIDDEN" });
	}
	if (!isServerRunActive(opts.runId)) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "Run is not an active server-run simulation",
		});
	}

	while (!opts.signal?.aborted) {
		const snapshot = getLiveRunState(opts.runId);
		if (!snapshot) {
			return;
		}
		yield snapshot;
		await new Promise((resolve) => setTimeout(resolve, WATCH_INTERVAL_MS));
	}
}
