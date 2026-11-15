import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";

import { db } from "~/server/db";
import { simulationRuns } from "~/server/db/schema";
import {
	type BoidGenes,
	type BoidState,
	computeAreaPopulationDensity,
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
	// S-24: the run's configured spatial extent — xyArea covers x and y,
	// zDepth covers z.
	xyArea: number;
	zDepth: number;
};

// live-parameter-adjustment (S-27): the subset of ServerRunParams a running
// server-owned simulation can be patched on, mid-run, via `applyLiveParams`.
export type LiveAdjustableParams = Pick<
	ServerRunParams,
	| "separationWeight"
	| "alignmentWeight"
	| "cohesionWeight"
	| "foodRegenRate"
	| "protectionThreshold"
>;

export type LiveParamPatch = Partial<LiveAdjustableParams>;

export type ParameterChangeEntry = {
	tick: number;
	field: keyof LiveAdjustableParams;
	oldValue: number;
	newValue: number;
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
	// S-25 (FR-010 full, FR-035): raw per-tick density samples feeding the
	// 5th scoring factor.
	populationDensitySamples: number[];
	// live-parameter-adjustment (S-27): changelog of live edits applied to
	// `params` while this run was ticking — not a per-tick sample, only grows
	// when `applyLiveParams` is called.
	parameterChanges: ParameterChangeEntry[];
	// live-parameter-adjustment (S-27), impl-review F1: last time
	// `applyLiveParams` actually applied a patch for this run, used to
	// server-side-throttle calls — the client's own 500ms Apply cooldown
	// (server-run-viewer.tsx) is UI-only and doesn't stop a direct tRPC call
	// (or a modified client) from pushing unbounded `parameterChanges`
	// entries for a run's entire duration.
	lastParamUpdateAt: number | null;
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
	// live-parameter-adjustment (S-27): the run's *current* live-adjustable
	// values — not the DB row's "started with" columns, which never change —
	// so the live-edit panel can pre-fill from them.
	liveParams: LiveAdjustableParams;
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
		liveParams: {
			separationWeight: run.params.separationWeight,
			alignmentWeight: run.params.alignmentWeight,
			cohesionWeight: run.params.cohesionWeight,
			foodRegenRate: run.params.foodRegenRate,
			protectionThreshold: run.params.protectionThreshold,
		},
	};
}

// live-parameter-adjustment (S-27), impl-review F1: minimum time between
// two applied patches for the same run — matches the client's own Apply
// cooldown (server-run-viewer.tsx's APPLY_COOLDOWN_MS) so a well-behaved
// client never actually hits this server-side floor; it exists only to
// bound a direct/malicious caller, not to shape normal UI behavior.
const PARAM_UPDATE_THROTTLE_MS = 500;

export type ApplyLiveParamsResult =
	| { status: "applied" }
	| { status: "not-found" }
	| { status: "throttled"; retryAfterMs: number };

// live-parameter-adjustment (S-27): the single place that patches a running
// `LiveRun.params` and appends changelog entries — exported so the
// `updateRunParams` tRPC mutation can call it, and so tests can call it
// directly (same testable-core pattern `watchServerRun`'s docstring already
// explains for this file). Entirely synchronous — no `await` between reading
// `run.params[field]` and the final reassignment, per the race-safety note
// on `LiveRun`'s module-state `Map`: a plain object reassignment cannot
// interleave with a `tick()` callback mid-write in Node's single-threaded
// event loop.
export function applyLiveParams(
	runId: number,
	patch: LiveParamPatch,
): ApplyLiveParamsResult {
	const run = registry.get(runId);
	if (!run) {
		return { status: "not-found" };
	}
	const now = Date.now();
	if (run.lastParamUpdateAt !== null) {
		const elapsed = now - run.lastParamUpdateAt;
		if (elapsed < PARAM_UPDATE_THROTTLE_MS) {
			return {
				status: "throttled",
				retryAfterMs: PARAM_UPDATE_THROTTLE_MS - elapsed,
			};
		}
	}
	const tick = run.populationCountSamples.length;
	for (const [field, newValue] of Object.entries(patch) as [
		keyof LiveAdjustableParams,
		number,
	][]) {
		run.parameterChanges.push({
			tick,
			field,
			oldValue: run.params[field],
			newValue,
		});
	}
	run.params = { ...run.params, ...patch };
	run.lastParamUpdateAt = now;
	return { status: "applied" };
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
			// S-25 (FR-010 full, FR-035): raw per-tick density samples feeding
			// the 5th scoring factor, persisted alongside its siblings.
			populationDensitySamples: number[];
			// live-parameter-adjustment (S-27): the changelog of live edits
			// applied while this run was ticking — mirrors the exact threading
			// pattern populationDensitySamples (S-25) established.
			parameterChanges: ParameterChangeEntry[];
			// compare-runs-side-by-side Phase 1: the survival factor
			// (computeScore's first argument), never persisted before —
			// without it the score can't be decomposed back into its four
			// factors for the comparison view.
			elapsedSeconds: number;
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
				populationDensitySamples: run.populationDensitySamples,
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
				worldSize: {
					x: run.params.xyArea,
					y: run.params.xyArea,
					z: run.params.zDepth,
				},
			},
		);

		run.boids = result.boids;
		run.predators = result.predators;
		run.foodStock = result.foodStock;
		run.cohesionSamples = result.cohesionSamples;
		run.foodRatioSamples = result.foodRatioSamples;
		run.populationCountSamples = result.populationCountSamples;
		run.populationDensitySamples = result.populationDensitySamples;
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
				computeAreaPopulationDensity(run.populationDensitySamples),
			);
			void finishRun(runId, {
				score,
				history: {
					phaseHistory: run.phaseHistory,
					foodRatioSamples: run.foodRatioSamples,
					survivorGenes: run.boids.map((b) => b.genes),
					populationCountSamples: run.populationCountSamples,
					populationDensitySamples: run.populationDensitySamples,
					parameterChanges: run.parameterChanges,
					elapsedSeconds: run.elapsedSeconds,
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

	const worldSize = {
		x: params.xyArea,
		y: params.xyArea,
		z: params.zDepth,
	};
	const boids = createInitialPopulation(
		params.boidCount,
		rng,
		maxLifespan,
		params.flockCount,
		flockWeights,
		worldSize,
	);
	const predators = createInitialPredators(
		params.predatorCount,
		rng,
		maxLifespan,
		params.flockCount,
		flockWeights,
		worldSize,
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
		populationDensitySamples: [],
		parameterChanges: [],
		lastParamUpdateAt: null,
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
		computeAreaPopulationDensity(run.populationDensitySamples),
	);
	await finishRun(runId, {
		score,
		history: {
			phaseHistory: run.phaseHistory,
			foodRatioSamples: run.foodRatioSamples,
			survivorGenes: run.boids.map((b) => b.genes),
			populationCountSamples: run.populationCountSamples,
			populationDensitySamples: run.populationDensitySamples,
			parameterChanges: run.parameterChanges,
			elapsedSeconds: run.elapsedSeconds,
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
	populationDensitySamples: number[];
	parameterChanges: ParameterChangeEntry[];
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
		populationDensitySamples: run.populationDensitySamples,
		parameterChanges: run.parameterChanges,
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
		// impl-review (area-aware-population-insight, F1): a `savedState` row
		// written by `savePause` before this field existed has no
		// `populationDensitySamples` key, so `snapshot.populationDensitySamples`
		// can be `undefined` here despite `ServerRunSnapshot`'s type claiming
		// otherwise — the cast at this function's only call site doesn't
		// actually validate the JSON shape. Without this fallback, the next
		// tick's `[...state.populationDensitySamples, rawDensity]`
		// (single-run-lifecycle.ts) throws, silently killing the resumed run
		// with a null score via `tick()`'s catch block.
		populationDensitySamples: snapshot.populationDensitySamples ?? [],
		// live-parameter-adjustment (S-27): same `?? []` fallback, same
		// reason — a `savedState` row written before this field existed has
		// no `parameterChanges` key despite `ServerRunSnapshot`'s type
		// claiming otherwise; without the fallback the changelog would be
		// `undefined` and `applyLiveParams`'s `.push` on a later live edit
		// would throw.
		parameterChanges: snapshot.parameterChanges ?? [],
		// live-parameter-adjustment (S-27), impl-review F1: deliberately not
		// carried through the snapshot — a resumed run's first live edit is
		// never throttled against activity from before the pause.
		lastParamUpdateAt: null,
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
