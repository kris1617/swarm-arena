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
	type PopulationPhase,
	type PredatorState,
	type PredatorTribeConfig,
	type TribeConfig,
	type WorldSize,
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

// unwatched-run-tick-throttling Phase 2: how long a run must have zero
// active watchers before it starts ticking at the accelerated rate — a
// brief watched->unwatched->watched flip (e.g. navigating between pages)
// should not trigger throttling.
const GRACE_PERIOD_MS = 5_000;

// unwatched-run-tick-throttling Phase 2: the fixed simulated-time multiplier
// applied to a genuinely-unwatched run's dtSeconds — only scales the
// simulated delta, never the real-time TICK_INTERVAL_MS scheduler cadence.
const THROTTLE_SPEED_MULTIPLIER = 3;

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
	energyThreshold: number;
	mutationChance: number;
	mutationMagnitude: number;
	// S-24: the run's configured spatial extent — xyArea covers x and y,
	// zDepth covers z.
	xyArea: number;
	zDepth: number;
	// per-tribe-behavior-weights: one TribeConfig per flock, index = flockId.
	// Phase 1 declared this type-only; Phase 2 wired it into
	// `startServerRun`/`adjustLivePopulation`'s `createInitialPopulation`/
	// `createInitialPredators` calls below.
	tribeConfigs: TribeConfig[];
	// predator-tribe-concept Phase 2: predators' own independent tribe
	// space — sibling to flockCount/tribeConfigs above, not a reuse of them.
	// `createInitialPredators`'s call sites below (startServerRun,
	// adjustLivePopulation's predator-growth branch) now read these instead
	// of params.flockCount/params.tribeConfigs.
	predatorFlockCount: number;
	predatorTribeConfigs: PredatorTribeConfig[];
};

// live-parameter-adjustment (S-27): the subset of ServerRunParams a running
// server-owned simulation can be patched on, mid-run, via `applyLiveParams`.
export type LiveAdjustableParams = Pick<
	ServerRunParams,
	| "foodRegenRate"
	| "protectionThreshold"
	| "energyThreshold"
	| "mutationChance"
	| "mutationMagnitude"
>;

export type LiveParamPatch = Partial<LiveAdjustableParams>;

export type ParameterChangeEntry = {
	tick: number;
	// live-boid-count-adjustment Phase 1: widened to also record a population-
	// count change (`adjustLivePopulation`'s changelog entry), alongside the
	// existing scalar `LiveAdjustableParams` fields `applyLiveParams` writes —
	// `LiveAdjustableParams`/`applyLiveParams` themselves stay untouched.
	// per-tribe-behavior-weights Phase 6: widened again for
	// `applyLiveTribeConfigs`'s own changelog entry — "tribeConfigs" marks a
	// wholesale array replacement, not a per-field numeric diff (the array
	// shape doesn't fit `oldValue`/`newValue: number` cleanly, so this entry
	// is a simplified boolean-style marker like a boolean field's 0/1
	// coercion in `applyLiveParams` below, not a real before/after value).
	// predator-tribe-concept Phase 5: widened again for
	// `applyLivePredatorTribeConfigs`'s own changelog entry — same
	// simplified boolean-style marker posture as "tribeConfigs" above, not a
	// real before/after value (array-shaped, doesn't fit `oldValue`/
	// `newValue: number`).
	field:
		| keyof LiveAdjustableParams
		| "boidCount"
		| "predatorCount"
		| "tribeConfigs"
		| "predatorTribeConfigs";
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
	// per-tribe-food-config Phase 5: one per-tick imbalance sample, threaded
	// through the same shared tick core as `foodRatioSamples` above.
	tribeFoodImbalanceSamples: number[];
	populationCountSamples: number[];
	// S-25 (FR-010 full, FR-035): raw per-tick density samples feeding the
	// 5th scoring factor.
	populationDensitySamples: number[];
	// genetic-diversity-trend Phase 1: one per-tick genetic-diversity sample,
	// threaded through the same shared tick core as the other sample arrays.
	geneticDiversitySamples: number[];
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
	// spatial-grid-dense-clustering-fallback Phase 3: persisted the same way
	// populationCapped/lastTimestamp are — reassigned from
	// computeSingleRunTick's result every tick, read back in on resume.
	hasWarnedDenseClustering: boolean;
	intervalId: ReturnType<typeof setInterval>;
	// unwatched-run-tick-throttling Phase 2: the set of currently-subscribed
	// `watchServerRun` callers, keyed by a per-subscription id generated in
	// that generator — not a count, so two overlapping subscriptions from the
	// same user (e.g. two open tabs) are tracked independently.
	watcherIds: Set<string>;
	// unwatched-run-tick-throttling Phase 2: the timestamp `watcherIds` last
	// became empty, or `null` while it's non-empty. `tick()` throttles once
	// `Date.now() - unwatchedSinceMs >= GRACE_PERIOD_MS`.
	unwatchedSinceMs: number | null;
	// unwatched-run-tick-throttling Phase 2: set once `tick()` has written
	// `wasEverThrottled = true` for this run, so later throttled ticks in the
	// same run's life don't re-issue the DB write.
	wasEverThrottledWritten: boolean;
	// per-tribe-food-config Phase 5: same write-once guard shape as
	// `wasEverThrottledWritten` above, for the `wasEverFoodImbalanced`
	// sticky marker.
	wasEverFoodImbalancedWritten: boolean;
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
	// test-plan-refresh-2026-11-16 Phase 1: the run's current food-stock
	// level — exposed so a behavioral test can observe foodRegenRate's
	// actual tick-over-tick effect on the stock, not just the stored param.
	// Mirrors `run.foodStock` (see `LiveRun`/`tick()` above) verbatim.
	foodStock: number;
	// live-parameter-adjustment (S-27): the run's *current* live-adjustable
	// values — not the DB row's "started with" columns, which never change —
	// so the live-edit panel can pre-fill from them.
	liveParams: LiveAdjustableParams;
	// per-tribe-behavior-weights Phase 6: the run's *current* per-tribe
	// config — sibling to `liveParams`, not nested inside it, since
	// `tribeConfigs` is explicitly NOT part of `LiveAdjustableParams` (it has
	// its own dedicated live-edit path, `applyLiveTribeConfigs`, below) —
	// exposed the same way so a future live-edit panel can pre-fill from it.
	tribeConfigs: TribeConfig[];
	// per-tribe-predator-config Phase 5: predator-side sibling of
	// `tribeConfigs` above — same rationale (its own dedicated live-edit
	// path, `applyLivePredatorTribeConfigs`), exposed so the new per-tribe
	// live-edit panel can pre-fill predator tribes too.
	predatorTribeConfigs: PredatorTribeConfig[];
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
		foodStock: run.foodStock,
		liveParams: {
			foodRegenRate: run.params.foodRegenRate,
			protectionThreshold: run.params.protectionThreshold,
			energyThreshold: run.params.energyThreshold,
			mutationChance: run.params.mutationChance,
			mutationMagnitude: run.params.mutationMagnitude,
		},
		tribeConfigs: run.params.tribeConfigs,
		predatorTribeConfigs: run.params.predatorTribeConfigs,
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
		number | boolean,
	][]) {
		const oldValue = run.params[field];
		run.parameterChanges.push({
			tick,
			field,
			oldValue: typeof oldValue === "boolean" ? Number(oldValue) : oldValue,
			newValue: typeof newValue === "boolean" ? Number(newValue) : newValue,
		});
	}
	run.params = { ...run.params, ...patch };
	run.lastParamUpdateAt = now;
	return { status: "applied" };
}

// per-tribe-behavior-weights Phase 6: a dedicated live-edit path for
// `tribeConfigs`, sibling to `applyLiveParams`/`adjustLivePopulation` — not
// folded into `applyLiveParams` itself because `ParameterChangeEntry.
// oldValue/newValue: number` can't represent an array-shaped diff cleanly.
// Shares `applyLiveParams`'s not-found/throttle checks and
// `lastParamUpdateAt` update (same `PARAM_UPDATE_THROTTLE_MS` floor, same
// shared throttle window — a direct/malicious caller can't bypass it by
// alternating between this and the other two live-edit mutations), but
// replaces `run.params.tribeConfigs` wholesale rather than diffing
// field-by-field. `tick()` reads `run.params.tribeConfigs` straight off the
// mutable `run.params` object every tick (see its own `params.tribeConfigs:
// run.params.tribeConfigs` call below), so this patch is visible to
// per-tick behavior (stepBoids' perception radii/burst, agedBoids' burst
// cost) starting the very next tick — the same "live edit visible on the
// next read, not frozen at creation" guarantee `applyLiveParams` already
// gives its own fields. It does NOT retroactively change any already-alive
// individual's own heritable genes (separationWeight/alignmentWeight/
// cohesionWeight/maxSpeed/minSpeed), which are set once at birth and never
// re-read from `tribeConfigs` afterward — same "affects the future, not
// already-alive individuals" semantic `mutationChance`/`mutationMagnitude`
// already established. A *new* individual seeded via `adjustLivePopulation`
// after this patch (createInitialPopulation/createInitialPredators, which
// read `run.params.tribeConfigs` directly) does pick up the new config.
// impl-review F3: this function trusts `patch`'s length wholesale — the
// router's `updateTribeConfigs` mutation (simulation.ts) is what actually
// enforces `patch.length === flockCount` before calling here. A caller that
// skipped that check couldn't crash anything downstream regardless (every
// `tribeConfigs[boid.genes.flockId]` read elsewhere already falls back to a
// global constant via `?? `/optional chaining on a missing index), but the
// invariant itself lives at the router, not here.
export function applyLiveTribeConfigs(
	runId: number,
	patch: TribeConfig[],
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
	// Simplified marker entry, not a per-field diff — see this function's own
	// comment above for why. `oldValue: 0, newValue: 1` reads as "changed" to
	// any consumer of the existing numeric changelog shape (e.g. the analysis
	// view's ReferenceLine overlay), without claiming a real before/after
	// numeric value that doesn't exist for an array field — mirrors the same
	// boolean-as-0/1 coercion `applyLiveParams`'s own generic boolean handling
	// still performs for any boolean-shaped `LiveAdjustableParams` field.
	run.parameterChanges.push({
		tick,
		field: "tribeConfigs",
		oldValue: 0,
		newValue: 1,
	});
	// per-tribe-food-config Phase 4: foodStockShare gets a one-time
	// delta-injection against the live pool instead of the wholesale-replace
	// every other field gets — the pool's current level is not something a
	// config replace should silently reset. Diffed against the CURRENT
	// stored value (the tribe's own last-submitted share, composable across
	// repeated edits), computed BEFORE `run.params` is replaced below so the
	// diff is always against the immediately-prior state, never the
	// original run-start value. foodRegenShare/foodConsumptionRate need no
	// such handling — Phase 2/3 already read `run.params.tribeConfigs` fresh
	// every tick, so the wholesale replace alone makes them take effect
	// starting the next tick.
	let foodStockDelta = 0;
	for (const [index, tribeConfig] of patch.entries()) {
		const previous = run.params.tribeConfigs[index];
		if (!previous) {
			continue;
		}
		foodStockDelta += tribeConfig.foodStockShare - previous.foodStockShare;
	}
	run.foodStock = Math.max(0, run.foodStock + foodStockDelta);
	run.params = { ...run.params, tribeConfigs: patch };
	run.lastParamUpdateAt = now;
	return { status: "applied" };
}

// predator-tribe-concept Phase 5: live-edit parity for the independent
// predator-tribe array — mirrors `applyLiveTribeConfigs` exactly (same
// not-found/throttle checks, same `lastParamUpdateAt` update, same shared
// throttle window), minus the `foodStockShare` delta-injection block: no
// predator-tribe field ties to a live mutable resource pool the way
// `tribeConfigs[].foodStockShare` does, so this is a pure wholesale
// replace. `tick()` reads `run.params.predatorTribeConfigs` straight off
// the mutable `run.params` object every tick (stepPredators' detection
// radius/burst/capture checks), so this patch is visible starting the very
// next tick — same "live edit visible on the next read, not frozen at
// creation" guarantee every other live-edit path here gives. It does NOT
// retroactively change any already-alive predator's own heritable genes,
// set once at birth and never re-read from `predatorTribeConfigs`
// afterward. impl-review F3 (mirrored): this function trusts `patch`'s
// length wholesale — the router's `updatePredatorTribeConfigs` mutation
// (simulation.ts) is what enforces `patch.length === predatorFlockCount`
// before calling here.
export function applyLivePredatorTribeConfigs(
	runId: number,
	patch: PredatorTribeConfig[],
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
	run.parameterChanges.push({
		tick,
		field: "predatorTribeConfigs",
		oldValue: 0,
		newValue: 1,
	});
	run.params = { ...run.params, predatorTribeConfigs: patch };
	run.lastParamUpdateAt = now;
	return { status: "applied" };
}

// live-boid-count-adjustment Phase 1: grows a freshly-generated batch toward
// the existing array's centroid (or the world center when the array is
// currently empty) so a population bump doesn't spawn visibly isolated from
// the rest of the flock — mutates `generated` in place, called before it's
// appended to the live array.
function clusterNewIndividuals<T extends { x: number; y: number; z: number }>(
	generated: T[],
	current: readonly { x: number; y: number; z: number }[],
	worldSize: WorldSize,
): void {
	const centroid =
		current.length > 0
			? {
					x: current.reduce((s, b) => s + b.x, 0) / current.length,
					y: current.reduce((s, b) => s + b.y, 0) / current.length,
					z: current.reduce((s, b) => s + b.z, 0) / current.length,
				}
			: { x: worldSize.x / 2, y: worldSize.y / 2, z: worldSize.z / 2 };
	for (const individual of generated) {
		individual.x = (individual.x + centroid.x) / 2;
		individual.y = (individual.y + centroid.y) / 2;
		individual.z = (individual.z + centroid.z) / 2;
	}
}

// live-boid-count-adjustment Phase 1: removes the `removeCount` lowest-energy
// individuals — same filter-by-membership idiom `applyPredation` (boids.ts)
// already uses, so a shrink removes the weakest individuals rather than an
// arbitrary subset.
function removeLowestEnergy<T extends { energy: number }>(
	current: T[],
	removeCount: number,
): T[] {
	const sorted = [...current].sort((a, b) => a.energy - b.energy);
	const toRemove = new Set(sorted.slice(0, removeCount));
	return current.filter((individual) => !toRemove.has(individual));
}

// live-boid-count-adjustment Phase 1: the single place that grows or shrinks
// a run's live `boids`/`predators` array by a signed delta — sibling to
// `applyLiveParams`, sharing its throttle/changelog pattern (same
// not-found/throttled checks, same `lastParamUpdateAt` update on success) so
// a direct/malicious caller can't bypass the 500ms floor by alternating
// between the two mutations. Exported so the router procedure can call it
// and so tests can call it directly, same testable-core pattern as
// `applyLiveParams`/`watchServerRun`.
export function adjustLivePopulation(
	runId: number,
	kind: "boid" | "predator",
	delta: number,
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

	// impl-review F2: a zero delta is a true no-op — skip the changelog push
	// and throttle update entirely rather than recording a no-change entry
	// and consuming the shared throttle window. Unreachable from the UI
	// (only ±10 is ever sent); only matters for a direct/malformed call.
	if (delta === 0) {
		return { status: "applied" };
	}

	// Same derivation startServerRun uses — growth needs to generate new
	// individuals exactly as the initial population was seeded. per-tribe-
	// behavior-weights Phase 2 (plan-review F2): reads the run's real
	// per-tribe `tribeConfigs`, not a flat array rebuilt from the run-level
	// separation/alignment/cohesion scalars — otherwise a boid/predator added
	// to a running simulation mid-run would seed with stale/default weights
	// instead of its tribe's actual configured values.
	const maxLifespan = Math.max(60, run.params.maxDurationSeconds);
	const worldSize = {
		x: run.params.xyArea,
		y: run.params.xyArea,
		z: run.params.zDepth,
	};

	const oldCount = kind === "boid" ? run.boids.length : run.predators.length;
	let newCount: number;

	if (kind === "boid") {
		if (delta > 0) {
			const generated = createInitialPopulation(
				delta,
				run.rng,
				maxLifespan,
				run.params.flockCount,
				run.params.tribeConfigs,
				worldSize,
			);
			clusterNewIndividuals(generated, run.boids, worldSize);
			run.boids = [...run.boids, ...generated];
		} else if (delta < 0) {
			run.boids = removeLowestEnergy(
				run.boids,
				Math.min(run.boids.length, -delta),
			);
		}
		newCount = run.boids.length;
	} else {
		if (delta > 0) {
			const generated = createInitialPredators(
				delta,
				run.rng,
				maxLifespan,
				run.params.predatorFlockCount,
				run.params.predatorTribeConfigs,
				worldSize,
			);
			clusterNewIndividuals(generated, run.predators, worldSize);
			run.predators = [...run.predators, ...generated];
		} else if (delta < 0) {
			run.predators = removeLowestEnergy(
				run.predators,
				Math.min(run.predators.length, -delta),
			);
		}
		newCount = run.predators.length;
	}

	const tick = run.populationCountSamples.length;
	run.parameterChanges.push({
		tick,
		field: kind === "boid" ? "boidCount" : "predatorCount",
		oldValue: oldCount,
		newValue: newCount,
	});
	run.params =
		kind === "boid"
			? { ...run.params, boidCount: newCount }
			: { ...run.params, predatorCount: newCount };
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
			// per-tribe-food-config Phase 5: persisted alongside
			// foodRatioSamples so a finished run's `computeResourceManagement`
			// recomputation (getRunsComparison) can reproduce its own score.
			tribeFoodImbalanceSamples: number[];
			survivorGenes: BoidGenes[];
			// S-11 (MS-08): the run-analysis-view's population-over-time chart
			// needs this time series — added alongside the other three.
			populationCountSamples: number[];
			// S-25 (FR-010 full, FR-035): raw per-tick density samples feeding
			// the 5th scoring factor, persisted alongside its siblings.
			populationDensitySamples: number[];
			// genetic-diversity-trend Phase 1: one per-tick genetic-diversity
			// sample, persisted alongside its siblings.
			geneticDiversitySamples: number[];
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

// refactor-opportunities Phase 1 (Candidate C): the single place that
// computes `score` and builds the 8-field `history` object from a live
// run's current state — `tick()`'s `shouldStop` branch and `stopServerRun()`
// both call this instead of hand-duplicating the `computeScore(...)` call
// and the object literal, so the two call sites can't drift out of sync
// with each other (or with `finishRun`'s own `history` type) again. Local
// to this file, same convention as `LiveRun`/`ServerRunSnapshot` above.
function buildFinishPayload(run: LiveRun): {
	score: number;
	history: NonNullable<Parameters<typeof finishRun>[1]["history"]>;
} {
	const score = computeScore(
		run.elapsedSeconds,
		computeResourceManagement(
			run.foodRatioSamples,
			run.tribeFoodImbalanceSamples,
		),
		computeGeneticDiversity(
			run.boids.map((b) => b.genes),
			run.params.tribeConfigs,
		),
		computePhaseQuality(run.phaseHistory),
		computeAreaPopulationDensity(run.populationDensitySamples),
	);
	return {
		score,
		history: {
			phaseHistory: run.phaseHistory,
			foodRatioSamples: run.foodRatioSamples,
			tribeFoodImbalanceSamples: run.tribeFoodImbalanceSamples,
			survivorGenes: run.boids.map((b) => b.genes),
			populationCountSamples: run.populationCountSamples,
			populationDensitySamples: run.populationDensitySamples,
			geneticDiversitySamples: run.geneticDiversitySamples,
			parameterChanges: run.parameterChanges,
			elapsedSeconds: run.elapsedSeconds,
		},
	};
}

function tick(runId: number): void {
	const run = registry.get(runId);
	if (!run) {
		return;
	}

	try {
		// unwatched-run-tick-throttling Phase 2: the grace period must have
		// fully elapsed with zero watchers — a run with at least one current
		// watcher has `unwatchedSinceMs === null` and never throttles.
		const isThrottled =
			run.unwatchedSinceMs !== null &&
			Date.now() - run.unwatchedSinceMs >= GRACE_PERIOD_MS;

		const result = computeSingleRunTick(
			{
				boids: run.boids,
				predators: run.predators,
				foodStock: run.foodStock,
				cohesionSamples: run.cohesionSamples,
				foodRatioSamples: run.foodRatioSamples,
				tribeFoodImbalanceSamples: run.tribeFoodImbalanceSamples,
				populationCountSamples: run.populationCountSamples,
				populationDensitySamples: run.populationDensitySamples,
				geneticDiversitySamples: run.geneticDiversitySamples,
				phaseHistory: run.phaseHistory,
				elapsedSeconds: run.elapsedSeconds,
				lastTimestamp: run.lastTimestamp,
				hasWarnedDenseClustering: run.hasWarnedDenseClustering,
			},
			Date.now(),
			{
				foodRegenRate: run.params.foodRegenRate,
				protectionThreshold: run.params.protectionThreshold,
				maxDurationSeconds: run.params.maxDurationSeconds,
				foodStockInitial: run.params.foodStockInitial,
				rng: run.rng,
				energyThreshold: run.params.energyThreshold,
				mutationChance: run.params.mutationChance,
				mutationMagnitude: run.params.mutationMagnitude,
				worldSize: {
					x: run.params.xyArea,
					y: run.params.xyArea,
					z: run.params.zDepth,
				},
				tribeConfigs: run.params.tribeConfigs,
				predatorTribeConfigs: run.params.predatorTribeConfigs,
				speedMultiplier: isThrottled ? THROTTLE_SPEED_MULTIPLIER : 1,
			},
		);

		if (result.wasThrottledThisTick && !run.wasEverThrottledWritten) {
			void db
				.update(simulationRuns)
				.set({ wasEverThrottled: true })
				.where(eq(simulationRuns.id, runId))
				.then(() => {
					// impl-review F1 (2026-11-17): only latch the write-once guard
					// on success — if the update fails, leave it false so the
					// next throttled tick retries, rather than letting a failed
					// write get stuck as false forever.
					run.wasEverThrottledWritten = true;
				})
				.catch((error: unknown) => {
					// Mirrors finishRun's fire-and-forget posture: this write
					// happens from inside a synchronous interval callback, so an
					// uncaught rejection here would be an unhandled promise
					// rejection. A failed write is retried on the next throttled
					// tick (the guard above stays false), not silently swallowed.
					console.error(
						`server run ${runId}: failed to write wasEverThrottled=true:`,
						error,
					);
				});
		}

		// per-tribe-food-config Phase 5: same write-once DB-write shape as
		// `wasEverThrottled` just above — set true the first tick a real
		// imbalance sample is actually measured, never cleared once set.
		if (result.wasImbalancedThisTick && !run.wasEverFoodImbalancedWritten) {
			void db
				.update(simulationRuns)
				.set({ wasEverFoodImbalanced: true })
				.where(eq(simulationRuns.id, runId))
				.then(() => {
					// Only latch the write-once guard on success — same reasoning
					// as `wasEverThrottledWritten` above: if the update fails,
					// leave it false so the next imbalanced tick retries, rather
					// than letting a failed write get stuck as false forever.
					run.wasEverFoodImbalancedWritten = true;
				})
				.catch((error: unknown) => {
					// Mirrors finishRun's fire-and-forget posture: this write
					// happens from inside a synchronous interval callback, so an
					// uncaught rejection here would be an unhandled promise
					// rejection. A failed write is retried on the next imbalanced
					// tick (the guard above stays false), not silently swallowed.
					console.error(
						`server run ${runId}: failed to write wasEverFoodImbalanced=true:`,
						error,
					);
				});
		}

		run.boids = result.boids;
		run.predators = result.predators;
		run.foodStock = result.foodStock;
		run.cohesionSamples = result.cohesionSamples;
		run.foodRatioSamples = result.foodRatioSamples;
		run.tribeFoodImbalanceSamples = result.tribeFoodImbalanceSamples;
		run.populationCountSamples = result.populationCountSamples;
		run.populationDensitySamples = result.populationDensitySamples;
		run.geneticDiversitySamples = result.geneticDiversitySamples;
		run.phaseHistory = result.phaseHistory;
		run.elapsedSeconds = result.elapsedSeconds;
		run.lastTimestamp = result.lastTimestamp;
		run.populationCapped = result.populationCapped;
		run.hasWarnedDenseClustering = result.hasWarnedDenseClustering;

		if (result.shouldStop) {
			void finishRun(runId, buildFinishPayload(run));
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

	const worldSize = {
		x: params.xyArea,
		y: params.xyArea,
		z: params.zDepth,
	};
	// per-tribe-behavior-weights Phase 2: seeds from the run's real
	// per-tribe `params.tribeConfigs`, not a flat array rebuilt from the
	// run-level separation/alignment/cohesion scalars — those scalars are
	// still stored on `params` (unchanged this phase) but no longer drive
	// seeding.
	const boids = createInitialPopulation(
		params.boidCount,
		rng,
		maxLifespan,
		params.flockCount,
		params.tribeConfigs,
		worldSize,
	);
	const predators = createInitialPredators(
		params.predatorCount,
		rng,
		maxLifespan,
		params.predatorFlockCount,
		params.predatorTribeConfigs,
		worldSize,
	);

	// per-tribe-food-config Phase 2: the live pool's initial stock is the
	// sum of each tribe's own foodStockShare, not the flat top-level
	// params.foodStockInitial scalar. params.foodStockInitial itself stays
	// on ServerRunParams/the DB schema (read by parameter-suggestion.ts and
	// corpus scripts, and kept for legacy history) but no longer drives a
	// live run's seed — same "old scalar field still exists, no longer
	// drives engine behavior" split F-09 already established for the
	// run-level separation/alignment/cohesion scalars above.
	const foodStockSeed = params.tribeConfigs.reduce(
		(sum, t) => sum + t.foodStockShare,
		0,
	);

	const run: LiveRun = {
		params,
		rng,
		boids,
		predators,
		foodStock: foodStockSeed,
		cohesionSamples: [],
		foodRatioSamples: [],
		tribeFoodImbalanceSamples: [],
		populationCountSamples: [],
		populationDensitySamples: [],
		geneticDiversitySamples: [],
		parameterChanges: [],
		lastParamUpdateAt: null,
		phaseHistory: [],
		elapsedSeconds: 0,
		lastTimestamp: null,
		populationCapped: false,
		hasWarnedDenseClustering: false,
		intervalId: setInterval(() => tick(params.runId), TICK_INTERVAL_MS),
		// unwatched-run-tick-throttling Phase 2: `unwatchedSinceMs` only ever
		// becomes non-null via `watchServerRun`'s own watcherIds-transitions-
		// to-empty rule — a run that has never been watched at all has no
		// such transition to record, so it starts (and stays) `null`/
		// unthrottled until the first watch/unwatch cycle. In practice every
		// server-owned run is watched immediately by the client that starts
		// it, so this only matters for a run nobody has ever opened.
		watcherIds: new Set(),
		unwatchedSinceMs: null,
		wasEverThrottledWritten: false,
		wasEverFoodImbalancedWritten: false,
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
	await finishRun(runId, buildFinishPayload(run));
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
	// per-tribe-food-config Phase 5: same pause/resume treatment as
	// foodRatioSamples — see resumeServerRun's `?? []` fallback below for a
	// `savedState` row written before this field existed.
	tribeFoodImbalanceSamples: number[];
	populationCountSamples: number[];
	populationDensitySamples: number[];
	geneticDiversitySamples: number[];
	parameterChanges: ParameterChangeEntry[];
	phaseHistory: PopulationPhase[];
	elapsedSeconds: number;
	lastTimestamp: number | null;
	populationCapped: boolean;
	// spatial-grid-dense-clustering-fallback Phase 3: persisted alongside
	// populationCapped so a resumed run doesn't re-log the warning for a
	// condition it already tripped before the pause.
	hasWarnedDenseClustering: boolean;
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
		tribeFoodImbalanceSamples: run.tribeFoodImbalanceSamples,
		populationCountSamples: run.populationCountSamples,
		populationDensitySamples: run.populationDensitySamples,
		geneticDiversitySamples: run.geneticDiversitySamples,
		parameterChanges: run.parameterChanges,
		phaseHistory: run.phaseHistory,
		elapsedSeconds: run.elapsedSeconds,
		lastTimestamp: run.lastTimestamp,
		populationCapped: run.populationCapped,
		hasWarnedDenseClustering: run.hasWarnedDenseClustering,
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
		// per-tribe-food-config Phase 5: same `?? []` fallback as the other
		// post-hoc-added sample arrays below — a `savedState` row written
		// before this field existed has no `tribeFoodImbalanceSamples` key
		// despite `ServerRunSnapshot`'s type claiming otherwise.
		tribeFoodImbalanceSamples: snapshot.tribeFoodImbalanceSamples ?? [],
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
		// genetic-diversity-trend Phase 1 (lessons.md's S-25 resume-path
		// rule): same `?? []` fallback, same reason — a `savedState` row
		// written before this field existed has no `geneticDiversitySamples`
		// key despite `ServerRunSnapshot`'s type claiming otherwise. Without
		// this fallback, the next tick's
		// `[...state.geneticDiversitySamples, ...]` spread
		// (single-run-lifecycle.ts) throws, silently killing the resumed run
		// with a null score via `tick()`'s catch block.
		geneticDiversitySamples: snapshot.geneticDiversitySamples ?? [],
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
		// spatial-grid-dense-clustering-fallback Phase 3: a `savedState` row
		// written before this field existed has no `hasWarnedDenseClustering`
		// key despite `ServerRunSnapshot`'s type claiming otherwise — same
		// `?? false` fallback pattern as the other post-hoc-added fields on
		// this snapshot (populationDensitySamples, geneticDiversitySamples,
		// parameterChanges) use for the identical reason.
		hasWarnedDenseClustering: snapshot.hasWarnedDenseClustering ?? false,
		intervalId: setInterval(() => tick(runId), TICK_INTERVAL_MS),
		// unwatched-run-tick-throttling Phase 2: neither `watcherIds` nor
		// `unwatchedSinceMs` is part of `ServerRunSnapshot` — same
		// deliberately-not-carried-through-the-pause posture as
		// `lastParamUpdateAt` just above (a resumed run's unwatched clock,
		// if any, does not resume counting from before the pause; it starts
		// fresh at `null`/unthrottled until the next watch/unwatch cycle,
		// which matters only for a run nobody re-watches after resuming).
		// `wasEverThrottled` (the DB column) likewise has no prior-pause
		// value to carry through here — the in-memory write-guard always
		// starts fresh at `false`.
		watcherIds: new Set(),
		unwatchedSinceMs: null,
		wasEverThrottledWritten: false,
		wasEverFoodImbalancedWritten: false,
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

	// unwatched-run-tick-throttling Phase 2: a unique id per subscription
	// (not per user/run) — two overlapping watchers of the same run (e.g.
	// two open tabs) must each hold their own entry in watcherIds, so the
	// set only empties once every subscription has ended.
	const watcherId = crypto.randomUUID();
	const run = registry.get(opts.runId);
	try {
		if (run) {
			run.watcherIds.add(watcherId);
			run.unwatchedSinceMs = null;
		}
		while (!opts.signal?.aborted) {
			const snapshot = getLiveRunState(opts.runId);
			if (!snapshot) {
				return;
			}
			yield snapshot;
			await new Promise((resolve) => setTimeout(resolve, WATCH_INTERVAL_MS));
		}
	} finally {
		// The run may have finished (and been removed from the registry)
		// while this generator was yielding — re-fetch rather than reuse the
		// `run` closed over above, which could be stale/removed.
		const currentRun = registry.get(opts.runId);
		if (currentRun) {
			currentRun.watcherIds.delete(watcherId);
			if (currentRun.watcherIds.size === 0) {
				currentRun.unwatchedSinceMs = Date.now();
			}
		}
	}
}
