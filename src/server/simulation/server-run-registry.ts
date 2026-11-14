import { eq } from "drizzle-orm";

import { db } from "~/server/db";
import { simulationRuns } from "~/server/db/schema";
import {
	type BoidState,
	computeScore,
	createInitialPopulation,
	createInitialPredators,
	type FlockWeights,
	type PredatorState,
} from "~/server/simulation/boids";
import { createRng } from "~/server/simulation/rng";
import { computeSingleRunTick } from "~/server/simulation/single-run-lifecycle";

// Same cadence the client's RAF loop approximates (~60fps) — keeps
// `elapsedSeconds` meaning wall-clock seconds, same as the client-driven
// staging path, rather than introducing a "simulation speed" concept.
const TICK_INTERVAL_MS = 16;

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
	rng: () => number;
	boids: BoidState[];
	predators: PredatorState[];
	foodStock: number;
	cohesionSamples: number[];
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
	outcome: { score: number | null },
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
		run.elapsedSeconds = result.elapsedSeconds;
		run.lastTimestamp = result.lastTimestamp;
		run.populationCapped = result.populationCapped;

		if (result.shouldStop) {
			const score = computeScore(run.cohesionSamples, run.elapsedSeconds);
			void finishRun(runId, { score });
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
	const score = computeScore(run.cohesionSamples, run.elapsedSeconds);
	await finishRun(runId, { score });
}
