import { TRPCError, tracked } from "@trpc/server";
import { and, count, desc, eq, gt, isNotNull } from "drizzle-orm";
import { z } from "zod";

import {
	adminProcedure,
	createTRPCRouter,
	protectedProcedure,
} from "~/server/api/trpc";
import type { db as dbSingleton } from "~/server/db";
import { adminSettings, simulationRuns } from "~/server/db/schema";
import {
	type BoidGenes,
	computeAreaPopulationDensity,
	computeAreaPredatorTribeBalance,
	computeGeneticDiversity,
	computePhaseQuality,
	computeResourceManagement,
	computeScore,
	FOOD_IMBALANCE_EPSILON,
	type PopulationPhase,
	PREDATOR_TRIBE_IMBALANCE_THRESHOLD,
	segmentCompletedCycles,
} from "~/server/simulation/boids";
import {
	checkLiveParamRangesSoft,
	DEFAULT_MAX_CONCURRENT_OBJECT_COUNT,
	DEFAULT_MAX_OBJECT_COUNT,
	DEFAULT_PARAMETER_RANGES,
	type ParameterRanges,
	PREDATOR_TRIBE_RANGED_FIELD_NAMES,
	RANGED_PARAMETER_NAMES,
	TOP_LEVEL_RANGED_PARAMETER_NAMES,
	TRIBE_RANGED_FIELD_NAMES,
} from "~/server/simulation/parameter-ranges";
import {
	type ParameterSuggestion,
	type SuggestionInputRow,
	suggestParameterChange,
} from "~/server/simulation/parameter-suggestion";
import { suggestRunOptimization } from "~/server/simulation/run-optimization-suggestion";
// Shared cap on how many simulations (staging or server-run) a user may
// have running at once, across every start path.
import { MAX_PARALLEL_RUNS } from "~/server/simulation/run-slots";
import {
	ScoredRun,
	type ScoredRunDisclosure,
} from "~/server/simulation/scored-run";
import {
	// live-boid-count-adjustment Phase 2: aliased to avoid colliding with
	// this file's own new `adjustLivePopulation` router procedure key — see
	// that procedure's body for the alias in use.
	adjustLivePopulation as adjustLivePopulationRegistry,
	applyLiveParams,
	applyLivePredatorTribeConfigs,
	applyLiveTribeConfigs,
	getLiveRunState,
	isServerRunActive,
	resumeServerRun,
	type ServerRunSnapshot,
	snapshotServerRun,
	startServerRun,
	watchServerRun,
} from "~/server/simulation/server-run-registry";

// ScoredRun.disclose() forces a runId; a null ScoredRun (unscored row) has
// nothing to disclose, so this fallback is the one place that decides what
// "no score yet" means for every comparability-bearing API surface.
function pickComparability(
	scoredRun: ScoredRun | null,
): Pick<ScoredRunDisclosure, "comparable" | "disclaimer"> {
	if (!scoredRun) {
		return { comparable: true, disclaimer: null };
	}
	const { comparable, disclaimer } = scoredRun.disclose();
	return { comparable, disclaimer };
}

// S-04 (FR-002 full): only basic type/sign sanity stays static here — the
// actual numeric ceilings are now admin-configurable (see
// `checkAgainstAdminRanges` below), not hardcoded. The pre-S-04 combined
// boid+predator cap (`.refine(... <= 500)`) moved into that same runtime
// check, against `adminSettings.maxObjectCount`, for the same reason: it
// can no longer be a static zod literal.
// per-tribe-behavior-weights Phase 6: extracted so `updateTribeConfigs`
// (below) validates a live-edit patch against the exact same per-tribe
// shape `start`/`startServer` validate at creation time, rather than
// hand-duplicating this object schema a second time and risking the two
// drifting apart.
const tribeConfigSchema = z.object({
	separation: z.number().finite(),
	alignment: z.number().finite(),
	cohesion: z.number().finite(),
	maxSpeed: z.number().finite(),
	minSpeed: z.number().finite(),
	matePreference: z.number().finite(),
	neighborRadius: z.number().finite(),
	separationRadius: z.number().finite(),
	predatorDetectionRadius: z.number().finite(),
	burstMult: z.number().finite(),
	burstCostMult: z.number().finite(),
	// per-tribe-food-config Phase 1: validated via the same generic
	// checkAgainstAdminRanges loop as the per-tribe-behavior-weights fields
	// above, once added to TRIBE_RANGED_FIELD_NAMES.
	foodStockShare: z.number().finite(),
	foodRegenShare: z.number().finite(),
	foodConsumptionRate: z.number().finite(),
	// per-tribe-predator-config Phase 2: replaces the old run-level
	// `crossbreedingEnabled` flag — cross-tribe mating is now allowed only
	// when BOTH tribes involved have this set true; same-tribe mating is
	// always allowed regardless (see `reproducePopulation` in boids.ts).
	crossbreedingEnabled: z.boolean(),
});

// predator-tribe-concept Phase 1: predators' own, fully independent
// per-tribe config shape — mirrors `tribeConfigSchema` above (same
// one-schema-two-consumers pattern: reused by both `startInputSchema` below
// and a future (Phase 5) `updatePredatorTribeConfigs` mutation's input), but
// validated against `PredatorTribeConfig` (boids.ts), never against boids'
// own `TribeConfig`.
const predatorTribeConfigSchema = z.object({
	separation: z.number().finite(),
	alignment: z.number().finite(),
	cohesion: z.number().finite(),
	maxSpeed: z.number().finite(),
	minSpeed: z.number().finite(),
	matePreference: z.number().finite(),
	detectionRadius: z.number().finite(),
	captureRadiusMult: z.number().finite(),
	// per-tribe-predator-config Phase 2: see `tribeConfigSchema`'s identical
	// field above for the semantics.
	crossbreedingEnabled: z.boolean(),
	// second-predator-tribe-prey-target Phase 2: fixed 2-value enum, not an
	// admin-rangeable number — deliberately NOT added to
	// PREDATOR_TRIBE_RANGED_FIELD_NAMES (parameter-ranges.ts). Backs both
	// startInputSchema.predatorTribeConfigs and updatePredatorTribeConfigs's
	// input via this single shared schema.
	preyTarget: z.enum(["boids", "boids-and-predators"]),
});

const startInputSchema = z.object({
	boidCount: z.number().int().positive(),
	separationWeight: z.number().finite(),
	alignmentWeight: z.number().finite(),
	cohesionWeight: z.number().finite(),
	maxDurationSeconds: z.number().int().positive(),
	predatorCount: z.number().int().nonnegative(),
	protectionThreshold: z.number().int().nonnegative(),
	foodStockInitial: z.number().finite().positive(),
	foodRegenRate: z.number().finite().nonnegative(),
	flockCount: z.number().int().min(2).max(4),
	energyThreshold: z.number().finite().positive(),
	mutationChance: z.number().min(0).max(1),
	mutationMagnitude: z.number().min(0).max(1),
	// S-24: the run's configured spatial extent — validated via the same
	// generic checkAgainstAdminRanges loop as every other ranged parameter.
	xyArea: z.number().int().positive(),
	zDepth: z.number().int().positive(),
	// per-tribe-behavior-weights Phase 1: one TribeConfig (boids.ts) per
	// flock, index = flockId (decided). zod can't cross-reference the
	// sibling `flockCount` field inside this z.object, so the
	// length-matches-flockCount check lives in `checkAgainstAdminRanges`
	// below instead, alongside the per-tribe range checks.
	tribeConfigs: z.array(tribeConfigSchema),
	// predator-tribe-concept Phase 1: predators' own, fully independent
	// tribe-count/tribe-config pair — same length-matches-count check posture
	// as `tribeConfigs`/`flockCount` above, enforced in
	// `checkAgainstAdminRanges` below since zod can't cross-reference a
	// sibling field inside this z.object.
	predatorFlockCount: z.number().int(),
	predatorTribeConfigs: z.array(predatorTribeConfigSchema),
});

// Singleton row id for `adminSettings` — see schema.ts's comment on the
// table for why this is an application-layer convention, not a DB
// constraint.
const ADMIN_SETTINGS_ID = 1;

export async function getOrSeedAdminSettings(db: typeof dbSingleton): Promise<{
	parameterRanges: ParameterRanges;
	maxObjectCount: number;
	maxConcurrentObjectCount: number;
}> {
	// impl-review F2: the read (findFirst) and the conditional write
	// (backfill upsert / first-run seed) are wrapped in one transaction —
	// without it, a concurrent updateParameterRanges call landing between
	// this function's read and write could have its fresh edit silently
	// overwritten by a backfill write computed from the now-stale snapshot
	// this function read. No other transaction use exists yet in this
	// codebase; this is the first.
	return db.transaction(async (tx) => {
		const existing = await tx.query.adminSettings.findFirst({
			where: (t, { eq: eqFn }) => eqFn(t.id, ADMIN_SETTINGS_ID),
		});
		if (existing) {
			const existingRanges = existing.parameterRanges as ParameterRanges;
			// admin-settings-range-backfill: a row created before a later
			// milestone added new RANGED_PARAMETER_NAMES entries is missing those
			// keys — backfill from DEFAULT_PARAMETER_RANGES (existing values win
			// per-key) and persist the merged result so the row becomes complete
			// going forward, instead of returning the stale, incomplete object.
			const merged: ParameterRanges = {
				...DEFAULT_PARAMETER_RANGES,
				...existingRanges,
			};
			// impl-review F1: compare by missing keys, not JSON.stringify —
			// a stringify compare is key-order-sensitive, not
			// value-sensitive, so two semantically-identical objects
			// serialized in a different key order would falsely look
			// "different" and trigger a needless write.
			const isMissingKeys = RANGED_PARAMETER_NAMES.some(
				(name) => !(name in existingRanges),
			);
			if (isMissingKeys) {
				await tx
					.insert(adminSettings)
					.values({
						id: ADMIN_SETTINGS_ID,
						parameterRanges: merged,
						maxObjectCount: existing.maxObjectCount,
						maxConcurrentObjectCount: existing.maxConcurrentObjectCount,
					})
					.onConflictDoUpdate({
						target: adminSettings.id,
						set: { parameterRanges: merged },
					});
			}
			return {
				parameterRanges: merged,
				maxObjectCount: existing.maxObjectCount,
				maxConcurrentObjectCount: existing.maxConcurrentObjectCount,
			};
		}
		// First-run seed: insert the default row matching the pre-S-04 hardcoded
		// bounds exactly, so nothing changes in practice until an admin edits it.
		await tx.insert(adminSettings).values({
			id: ADMIN_SETTINGS_ID,
			parameterRanges: DEFAULT_PARAMETER_RANGES,
			maxObjectCount: DEFAULT_MAX_OBJECT_COUNT,
			maxConcurrentObjectCount: DEFAULT_MAX_CONCURRENT_OBJECT_COUNT,
		});
		return {
			parameterRanges: DEFAULT_PARAMETER_RANGES,
			maxObjectCount: DEFAULT_MAX_OBJECT_COUNT,
			maxConcurrentObjectCount: DEFAULT_MAX_CONCURRENT_OBJECT_COUNT,
		};
	});
}

// F-07: the sum of boidCount+predatorCount across every one of `userId`'s
// OTHER currently server-ticking runs (excluding `excludeRunId`, the run
// being started/resumed right now — it isn't registered in
// server-run-registry.ts yet at the point this is called) plus
// `thisRunObjectCount` must not exceed the admin's configured
// `maxConcurrentObjectCount`. Scoped to server-owned ticking specifically
// via `isServerRunActive` — a client-staged `start` run also shows
// `status: "running"` in the DB but never touches server-run-registry.ts,
// so it must never count toward or be blocked by this ceiling.
async function assertWithinConcurrentObjectCeiling(
	db: typeof dbSingleton,
	userId: string,
	thisRunObjectCount: number,
	excludeRunId: number,
): Promise<void> {
	const { maxConcurrentObjectCount } = await getOrSeedAdminSettings(db);
	const runningRows = await db
		.select({
			id: simulationRuns.id,
			boidCount: simulationRuns.boidCount,
			predatorCount: simulationRuns.predatorCount,
		})
		.from(simulationRuns)
		.where(
			and(
				eq(simulationRuns.userId, userId),
				eq(simulationRuns.status, "running"),
			),
		);
	const otherServerTickingTotal = runningRows
		.filter((row) => row.id !== excludeRunId && isServerRunActive(row.id))
		.reduce((sum, row) => sum + row.boidCount + row.predatorCount, 0);
	const total = otherServerTickingTotal + thisRunObjectCount;
	if (total > maxConcurrentObjectCount) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: `Starting this run would bring your combined server-run population to ${total}, over the ${maxConcurrentObjectCount} limit — stop another server run first.`,
		});
	}
}

// live-boid-count-adjustment Phase 2: soft (warn, don't block) counterpart
// to `checkAgainstAdminRanges`'s per-run combined-count cap, reused only by
// the `adjustLivePopulation` live-adjust path — out-of-range live edits warn
// rather than reject, same posture as `checkLiveParamRangesSoft`. Pure
// function, no `db` needed.
function checkPerRunObjectCapSoft(
	otherFieldCount: number,
	newCount: number,
	maxObjectCount: number,
): string | null {
	const total = otherFieldCount + newCount;
	if (total > maxObjectCount) {
		return `boidCount + predatorCount would be ${total}, over the per-run limit of ${maxObjectCount}`;
	}
	return null;
}

// live-boid-count-adjustment Phase 2: soft counterpart to
// `assertWithinConcurrentObjectCeiling`, but sources *other* runs' counts
// from their live registry state (`getLiveRunState`) rather than the DB's
// start-time `boidCount`/`predatorCount` columns — a prior live-adjust on
// another run would otherwise make a DB-sourced sum stale. Takes `db` as an
// explicit parameter (per the router-helper lesson in
// context/foundation/lessons.md), matching
// `assertWithinConcurrentObjectCeiling`'s own signature shape.
async function checkConcurrentObjectCapSoft(
	db: typeof dbSingleton,
	userId: string,
	thisRunNewTotal: number,
	excludeRunId: number,
	maxConcurrentObjectCount: number,
): Promise<string | null> {
	const runningRows = await db
		.select({
			id: simulationRuns.id,
			boidCount: simulationRuns.boidCount,
			predatorCount: simulationRuns.predatorCount,
		})
		.from(simulationRuns)
		.where(
			and(
				eq(simulationRuns.userId, userId),
				eq(simulationRuns.status, "running"),
			),
		);
	const otherServerTickingTotal = runningRows
		.filter((row) => row.id !== excludeRunId && isServerRunActive(row.id))
		.reduce((sum, row) => {
			// Narrow race guard: `isServerRunActive` confirmed a registry entry
			// a moment ago, but the run could have stopped naturally between
			// that check and this read — fall back to the DB row's start-time
			// columns rather than throwing.
			const live = getLiveRunState(row.id);
			return (
				sum +
				(live
					? live.boids.length + live.predators.length
					: row.boidCount + row.predatorCount)
			);
		}, 0);
	const total = otherServerTickingTotal + thisRunNewTotal;
	if (total > maxConcurrentObjectCount) {
		return `This would bring your combined server-run population to ${total}, over the ${maxConcurrentObjectCount} limit across your running simulations`;
	}
	return null;
}

function checkAgainstAdminRanges(
	input: z.infer<typeof startInputSchema>,
	ranges: ParameterRanges,
	maxObjectCount: number,
): void {
	for (const name of TOP_LEVEL_RANGED_PARAMETER_NAMES) {
		const value = input[name];
		if (typeof value === "boolean") {
			continue;
		}
		const range = ranges[name];
		if (value < range.min || value > range.max) {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: `${name} must be between ${range.min} and ${range.max}`,
			});
		}
	}
	if (input.boidCount + input.predatorCount > maxObjectCount) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: `boidCount + predatorCount must not exceed ${maxObjectCount}`,
		});
	}

	// per-tribe-behavior-weights Phase 1: one TribeConfig per flock, index =
	// flockId — a length mismatch means the client sent a config that
	// doesn't cover every tribe (or covers too many).
	if (input.tribeConfigs.length !== input.flockCount) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: `tribeConfigs must have exactly ${input.flockCount} entries (one per flock), got ${input.tribeConfigs.length}`,
		});
	}
	for (const tribeConfig of input.tribeConfigs) {
		for (const name of TRIBE_RANGED_FIELD_NAMES) {
			const value = tribeConfig[name];
			const range = ranges[name];
			if (value < range.min || value > range.max) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: `${name} must be between ${range.min} and ${range.max}`,
				});
			}
		}
	}

	// predator-tribe-concept Phase 1: predators' own, fully independent
	// tribe-count/tribe-config pair — same length-matches-count and
	// per-tribe-range checks as boids' own tribeConfigs/flockCount above,
	// against the predator-specific field set.
	if (input.predatorTribeConfigs.length !== input.predatorFlockCount) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: `predatorTribeConfigs must have exactly ${input.predatorFlockCount} entries (one per predator flock), got ${input.predatorTribeConfigs.length}`,
		});
	}
	for (const predatorTribeConfig of input.predatorTribeConfigs) {
		for (const name of PREDATOR_TRIBE_RANGED_FIELD_NAMES) {
			const value = predatorTribeConfig[name];
			const range = ranges[name];
			if (value < range.min || value > range.max) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: `${name} must be between ${range.min} and ${range.max}`,
				});
			}
		}
	}
}

// security-hardening-pass Phase 2: separate per-hour budgets for the two
// mutations that create a `simulationRuns` row — `start`'s client-ticked
// path (cheap, client-owned ticking) gets a much higher budget than
// `startServer`'s server-owned path (ticks on the server's own CPU/memory
// budget, so each one is relatively expensive). Same DB-counted-window
// pattern as `feedback.ts`'s `MAX_REPORTS_PER_HOUR`/`RATE_LIMIT_WINDOW_MS` —
// counted directly off `simulation_run` rather than a separate counter
// table.
const MAX_CLIENT_RUNS_PER_HOUR = 20;
const MAX_SERVER_RUNS_PER_HOUR = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 60_000;

// Shared by `start` and `startServer` — both need identical validation,
// capacity-check, and insert behavior; only what ticks the row afterward
// differs (the client's RAF loop vs. startServerRun). Extracted here so the
// two paths can never silently drift apart.
//
// Takes `db` as a parameter (the exact `ctx.db` instance), not the module
// singleton — `simulation.test.ts`'s race tests inject a sabotaging Proxy
// via `createCaller({ db: sabotagingDb, ... })` to reproduce an exact
// concurrent-insert timing; reading the global singleton directly here
// would silently bypass that injection and break those tests.
async function insertRunningSimulation(
	db: typeof dbSingleton,
	userId: string,
	input: z.infer<typeof startInputSchema>,
	runMode: "client" | "server",
): Promise<{ runId: number; seed: number }> {
	const { parameterRanges, maxObjectCount } = await getOrSeedAdminSettings(db);
	checkAgainstAdminRanges(input, parameterRanges, maxObjectCount);

	// security-hardening-pass Phase 2: per-mutation rate limit, checked
	// before the MAX_PARALLEL_RUNS concurrency check below — mirrors
	// feedback.ts's check-then-insert order exactly.
	const rateLimitWindowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MS);
	const [recentRunCountRow] = await db
		.select({ recentCount: count() })
		.from(simulationRuns)
		.where(
			and(
				eq(simulationRuns.userId, userId),
				eq(simulationRuns.runMode, runMode),
				gt(simulationRuns.startedAt, rateLimitWindowStart),
			),
		);
	const recentRunCount = recentRunCountRow?.recentCount ?? 0;
	const maxRunsPerHour =
		runMode === "client" ? MAX_CLIENT_RUNS_PER_HOUR : MAX_SERVER_RUNS_PER_HOUR;
	if (recentRunCount >= maxRunsPerHour) {
		throw new TRPCError({
			code: "TOO_MANY_REQUESTS",
			message:
				runMode === "client"
					? "You've started too many client-ticked simulations in the last hour — try again later."
					: "You've started too many server-owned simulations in the last hour — try again later.",
		});
	}

	const [runningCountRow] = await db
		.select({ runningCount: count() })
		.from(simulationRuns)
		.where(
			and(
				eq(simulationRuns.userId, userId),
				eq(simulationRuns.status, "running"),
			),
		);
	const runningCount = runningCountRow?.runningCount ?? 0;
	if (runningCount >= MAX_PARALLEL_RUNS) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: `Already running ${MAX_PARALLEL_RUNS} simulations — stop one before starting another.`,
		});
	}

	const seed = Date.now() ^ Math.floor(Math.random() * 2 ** 31);

	const [run] = await db
		.insert(simulationRuns)
		.values({
			userId,
			seed,
			boidCount: input.boidCount,
			separationWeight: input.separationWeight,
			alignmentWeight: input.alignmentWeight,
			cohesionWeight: input.cohesionWeight,
			maxDurationSeconds: input.maxDurationSeconds,
			predatorCount: input.predatorCount,
			protectionThreshold: input.protectionThreshold,
			foodStockInitial: input.foodStockInitial,
			foodRegenRate: input.foodRegenRate,
			flockCount: input.flockCount,
			energyThreshold: input.energyThreshold,
			mutationChance: input.mutationChance,
			mutationMagnitude: input.mutationMagnitude,
			xyArea: input.xyArea,
			zDepth: input.zDepth,
			tribeConfigs: input.tribeConfigs,
			predatorFlockCount: input.predatorFlockCount,
			predatorTribeConfigs: input.predatorTribeConfigs,
			status: "running",
			runMode,
		})
		.returning({ id: simulationRuns.id });

	if (!run) {
		throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
	}

	// impl-review F3: the identical race the MAX_PARALLEL_RUNS check below
	// guards against (a concurrent call passing the pre-insert count check
	// before either insert lands) applies equally to the rate-limit check
	// above — mirror the same post-insert recheck here, for consistency.
	// Unlike MAX_PARALLEL_RUNS's own recheck, the rate-limit count has no
	// `status` filter (a stopped run still counts as an "attempt" within
	// the window), so flipping this row to "stopped" doesn't remove it
	// from the count the way it does there — it still rejects the
	// over-threshold request and leaves a real history row, matching this
	// file's own "mark stopped, never delete" convention for a
	// post-insert failure (e.g. `startServer`'s own catch blocks below).
	const [rateLimitRecheckRow] = await db
		.select({ recentCount: count() })
		.from(simulationRuns)
		.where(
			and(
				eq(simulationRuns.userId, userId),
				eq(simulationRuns.runMode, runMode),
				gt(simulationRuns.startedAt, rateLimitWindowStart),
			),
		);
	if ((rateLimitRecheckRow?.recentCount ?? 0) > maxRunsPerHour) {
		await db
			.update(simulationRuns)
			.set({ status: "stopped" })
			.where(eq(simulationRuns.id, run.id));
		throw new TRPCError({
			code: "TOO_MANY_REQUESTS",
			message:
				runMode === "client"
					? "You've started too many client-ticked simulations in the last hour — try again later."
					: "You've started too many server-owned simulations in the last hour — try again later.",
		});
	}

	// Race-safety net: a concurrent `start`/`startServer` call can pass the
	// count check above before either insert lands, breaching the cap. Catch
	// it immediately after this insert and invalidate the row this call just
	// created rather than trusting the pre-insert count alone.
	const [recheckRow] = await db
		.select({ runningCount: count() })
		.from(simulationRuns)
		.where(
			and(
				eq(simulationRuns.userId, userId),
				eq(simulationRuns.status, "running"),
			),
		);
	if ((recheckRow?.runningCount ?? 0) > MAX_PARALLEL_RUNS) {
		await db
			.update(simulationRuns)
			.set({ status: "stopped" })
			.where(eq(simulationRuns.id, run.id));
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: `Already running ${MAX_PARALLEL_RUNS} simulations — stop one before starting another.`,
		});
	}

	return { runId: run.id, seed };
}

export const simulationRouter = createTRPCRouter({
	start: protectedProcedure
		.input(startInputSchema)
		.mutation(async ({ ctx, input }) => {
			const userId = ctx.session.user.id;
			if (!userId) {
				throw new TRPCError({ code: "UNAUTHORIZED" });
			}
			return insertRunningSimulation(ctx.db, userId, input, "client");
		}),

	// S-06: starts a real (non-staging) simulation whose execution is owned
	// by the server from the moment it's created — no client tick loop
	// involved at all, unlike `start` (which the client itself ticks).
	startServer: protectedProcedure
		.input(startInputSchema)
		.mutation(async ({ ctx, input }) => {
			const userId = ctx.session.user.id;
			if (!userId) {
				throw new TRPCError({ code: "UNAUTHORIZED" });
			}
			const { runId, seed } = await insertRunningSimulation(
				ctx.db,
				userId,
				input,
				"server",
			);
			try {
				await assertWithinConcurrentObjectCeiling(
					ctx.db,
					userId,
					input.boidCount + input.predatorCount,
					runId,
				);
			} catch (error) {
				// Same rollback shape as the startServerRun catch below — the
				// row above is already "running" with nothing now tracking
				// it, so it must not silently occupy a slot forever.
				await ctx.db
					.update(simulationRuns)
					.set({ status: "stopped", stoppedAt: new Date() })
					.where(eq(simulationRuns.id, runId));
				throw error;
			}
			try {
				startServerRun({ runId, seed, ...input });
			} catch (error) {
				// startServerRun threw before registering the run (e.g. building
				// the initial population failed) — the row above was already
				// inserted as "running" with nothing now tracking it. Flip it
				// back to "stopped" so it doesn't silently occupy a
				// MAX_PARALLEL_RUNS slot forever with no way to recover
				// visibility of it, then surface the failure to the caller
				// instead of returning a false-positive success.
				console.error(
					`startServer: startServerRun failed for run ${runId} — marking it stopped:`,
					error,
				);
				await ctx.db
					.update(simulationRuns)
					.set({ status: "stopped", stoppedAt: new Date() })
					.where(eq(simulationRuns.id, runId));
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: "Failed to start the server-run simulation",
				});
			}
			return { runId, seed };
		}),

	stop: protectedProcedure
		.input(
			z.object({
				runId: z.number(),
				elapsedTicks: z.number().nonnegative(),
				// .max(50_000) closes an unbounded-array resource surface — generous
				// relative to the 600s run cap above even at a high sample rate.
				cohesionSamples: z.array(z.number().min(0).max(1)).min(1).max(50_000),
				// S-04 (FR-010 full, FR-019): the client-staged path's scoring
				// signals, matching the server-owned path's locally-tracked state
				// (server-run-registry.ts). Raw signals, not pre-computed factor
				// numbers — the server computes the score, same trust posture
				// `cohesionSamples` already established.
				foodRatioSamples: z.array(z.number().min(0).max(1)).min(1).max(50_000),
				phaseHistory: z
					.array(
						z.enum([
							"establishment",
							"growth",
							"overshoot",
							"crash",
							"recovery",
						]),
					)
					.min(1)
					.max(50_000),
				survivingBoidGenes: z
					.array(
						z.object({
							color: z.object({
								r: z.number(),
								g: z.number(),
								b: z.number(),
							}),
							flockId: z.number(),
							separationWeight: z.number(),
							alignmentWeight: z.number(),
							cohesionWeight: z.number(),
							maxSpeed: z.number(),
							minSpeed: z.number(),
							maxLifespan: z.number(),
							matePreference: z.number(),
						}),
					)
					// impl-review (full-score-save-resume, F2): same unbounded-array
					// resource surface the three sibling fields above already
					// close, just missed for this one — each element here is
					// heavier (8 fields vs. a number) and is iterated multiple
					// times by computeGeneticDiversity.
					.max(50_000),
				// S-11 (MS-08): the run-analysis-view's population-over-time
				// chart needs this time series — same bound pattern as its
				// three siblings above.
				populationCountSamples: z
					.array(z.number().int().nonnegative())
					.min(1)
					.max(50_000),
				// S-25 (FR-010 full, FR-035): raw per-tick density samples
				// feeding the 5th scoring factor — same bound posture as every
				// sibling sample-array field.
				populationDensitySamples: z.array(z.number().min(0)).min(1).max(50_000),
				// genetic-diversity-trend Phase 1: the client-staged path's own
				// per-tick genetic-diversity sample array — optional (unlike its
				// siblings above) so a caller/test fixture built before this field
				// existed still validates.
				geneticDiversitySamples: z
					.array(z.number().min(0).max(1))
					.min(1)
					.max(50_000)
					.optional(),
				// per-tribe-food-config impl-review F1: the client-staged path's
				// own per-tick food-imbalance sample array, mirroring the
				// server-owned path's equivalent (server-run-registry.ts's
				// `tick()`). Optional, same backward-compat posture as
				// `geneticDiversitySamples` above — a caller/test fixture built
				// before this field existed still validates.
				tribeFoodImbalanceSamples: z
					.array(z.number().min(0))
					.min(1)
					.max(50_000)
					.optional(),
				// second-predator-tribe-prey-target Phase 3: the client-staged
				// path's own per-tick predator-tribe balance sample array,
				// mirroring the server-owned path's equivalent
				// (server-run-registry.ts's `tick()`). Optional, same
				// backward-compat posture as `tribeFoodImbalanceSamples`/
				// `geneticDiversitySamples` above — a caller/test fixture built
				// before this field existed still validates. `.min(1)` (not
				// `.min(0)`) because every real tick pushes one sample
				// regardless of predator-tribe count (the neutral 1.0 default
				// for <2 tribes) — a submitted array is never legitimately
				// empty for a run that ticked at all.
				predatorTribeBalanceSamples: z
					.array(z.number().min(0).max(1))
					.min(1)
					.max(50_000)
					.optional(),
				// client-staged-live-parameter-parity Phase 3: the client-staged
				// path's own changelog of applied live edits, matching the
				// server-owned path's `ParameterChangeEntry` shape
				// (server-run-registry.ts) and threaded into `history` below so
				// the analysis view's ReferenceLine overlay renders them for a
				// completed client-staged run too. No `.min()` — an empty
				// changelog is legitimate: the user may never have touched the
				// live-edit panel.
				parameterChanges: z
					.array(
						z.object({
							tick: z.number().int().nonnegative(),
							// per-tribe-behavior-weights Phase 6: widened by one literal
							// — "tribeConfigs" — to match `ParameterChangeEntry.field`'s
							// own widened union (server-run-registry.ts). The
							// client-staged path (this procedure's caller) never
							// actually produces a "tribeConfigs" entry itself (F3 scope:
							// it never touches `applyLiveTribeConfigs`), but this input
							// schema must still accept the full shape of what it's
							// typed to receive.
							// predator-tribe-concept Phase 5: widened again by
							// "predatorTribeConfigs" for the same reason — the
							// client-staged path never produces this entry either (it
							// never touches `applyLivePredatorTribeConfigs`), but the
							// schema must accept the full `ParameterChangeEntry.field`
							// union it's typed to receive.
							field: z.enum([
								...RANGED_PARAMETER_NAMES,
								"tribeConfigs",
								"predatorTribeConfigs",
							]),
							oldValue: z.number(),
							newValue: z.number(),
						}),
					)
					.max(50_000),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const run = await ctx.db.query.simulationRuns.findFirst({
				where: (simulationRuns, { eq }) => eq(simulationRuns.id, input.runId),
			});

			if (!run) {
				throw new TRPCError({ code: "BAD_REQUEST" });
			}

			if (run.userId !== ctx.session.user.id) {
				throw new TRPCError({ code: "FORBIDDEN" });
			}

			if (run.status !== "running") {
				throw new TRPCError({ code: "BAD_REQUEST" });
			}

			// impl-review (full-score-save-resume, F1): a server-owned run's
			// row also has `status: "running"` — nothing in the DB alone
			// distinguishes it from a client-staged one. Without this check, a
			// `stop` call against a server-owned run would score/terminate the
			// row while the registry's live interval keeps ticking it,
			// eventually overwriting this call's score when the run later
			// finishes naturally. Server-owned runs go through
			// `savePause`/natural completion instead.
			if (isServerRunActive(input.runId)) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Run is server-owned — use savePause instead of stop",
				});
			}

			const clampedElapsedTicks = Math.min(
				input.elapsedTicks,
				run.maxDurationSeconds + 1,
			);

			const score = computeScore(
				clampedElapsedTicks,
				computeResourceManagement(
					input.foodRatioSamples,
					input.tribeFoodImbalanceSamples,
				),
				computeGeneticDiversity(input.survivingBoidGenes),
				computePhaseQuality(input.phaseHistory),
				computeAreaPopulationDensity(input.populationDensitySamples),
				computeAreaPredatorTribeBalance(
					input.predatorTribeBalanceSamples ?? [],
				),
			);
			// per-tribe-food-config impl-review F1: mirrors the server-owned
			// path's write-once `wasEverFoodImbalanced` marker — this path has
			// no live interval to latch it tick-by-tick, so it's derived once
			// here from the full sample array instead.
			const wasEverFoodImbalanced =
				input.tribeFoodImbalanceSamples?.some(
					(sample) => sample > FOOD_IMBALANCE_EPSILON,
				) ?? false;
			// second-predator-tribe-prey-target Phase 3: same derived-once-
			// in-one-shot pattern as `wasEverFoodImbalanced` just above, for
			// the predator-tribe-balance comparability marker.
			const wasEverPredatorTribeImbalanced =
				input.predatorTribeBalanceSamples?.some(
					(sample) => sample < PREDATOR_TRIBE_IMBALANCE_THRESHOLD,
				) ?? false;

			// Race-safety net: a second concurrent `stop` call for the same run
			// can pass the read-time check above before either write lands. The
			// status guard here makes that race fail loudly instead of silently
			// overwriting whichever caller's write landed first.
			const [stopped] = await ctx.db
				.update(simulationRuns)
				.set({
					status: "stopped",
					score,
					stoppedAt: new Date(),
					wasEverFoodImbalanced,
					wasEverPredatorTribeImbalanced,
					// F-05 (MS-08): persist alongside the score instead of
					// discarding — matches server-run-registry.ts's finishRun.
					history: {
						phaseHistory: input.phaseHistory,
						foodRatioSamples: input.foodRatioSamples,
						tribeFoodImbalanceSamples: input.tribeFoodImbalanceSamples,
						survivorGenes: input.survivingBoidGenes,
						populationCountSamples: input.populationCountSamples,
						populationDensitySamples: input.populationDensitySamples,
						geneticDiversitySamples: input.geneticDiversitySamples,
						predatorTribeBalanceSamples: input.predatorTribeBalanceSamples,
						// compare-runs-side-by-side Phase 1: the survival
						// factor, matching server-run-registry.ts's two write
						// sites — reuses the same value already computed for
						// computeScore's first argument above.
						elapsedSeconds: clampedElapsedTicks,
						// client-staged-live-parameter-parity Phase 3: persisted
						// alongside the other history fields so the analysis
						// view's ReferenceLine overlay renders applied live
						// edits for a client-staged run too, matching the
						// server-owned path's `finishRun` write.
						parameterChanges: input.parameterChanges,
					},
				})
				.where(
					and(
						eq(simulationRuns.id, input.runId),
						eq(simulationRuns.status, "running"),
					),
				)
				.returning({ id: simulationRuns.id });

			if (!stopped) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Run already stopped",
				});
			}

			return { score };
		}),

	watch: protectedProcedure
		.input(z.object({ runId: z.number() }))
		.subscription(async function* ({ input, ctx, signal }) {
			const userId = ctx.session.user.id;
			if (!userId) {
				throw new TRPCError({ code: "UNAUTHORIZED" });
			}
			let eventId = 0;
			for await (const snapshot of watchServerRun({
				runId: input.runId,
				userId,
				signal,
			})) {
				yield tracked(String(eventId++), snapshot);
			}
		}),

	// S-08: lets the client discover all of the caller's currently-running
	// server simulations, for the list/switch UI.
	listRunning: protectedProcedure.query(async ({ ctx }) => {
		const userId = ctx.session.user.id;
		if (!userId) {
			throw new TRPCError({ code: "UNAUTHORIZED" });
		}
		return ctx.db
			.select({
				id: simulationRuns.id,
				startedAt: simulationRuns.startedAt,
				boidCount: simulationRuns.boidCount,
				predatorCount: simulationRuns.predatorCount,
				// S-24 Phase 2: ServerRunViewer needs the viewed run's real
				// configured world size to derive its camera's zoom limits
				// (camera.ts's computeMinZoom) — never a hardcoded 200.
				xyArea: simulationRuns.xyArea,
				zDepth: simulationRuns.zDepth,
			})
			.from(simulationRuns)
			.where(
				and(
					eq(simulationRuns.userId, userId),
					eq(simulationRuns.status, "running"),
				),
			)
			.orderBy(desc(simulationRuns.startedAt));
	}),

	// S-04 Phase 4 (FR-012): mirrors listRunning but for paused server-owned
	// runs, feeding the "Saved" section's "Resume" list.
	listSaved: protectedProcedure.query(async ({ ctx }) => {
		const userId = ctx.session.user.id;
		if (!userId) {
			throw new TRPCError({ code: "UNAUTHORIZED" });
		}
		return ctx.db
			.select({
				id: simulationRuns.id,
				startedAt: simulationRuns.startedAt,
				boidCount: simulationRuns.boidCount,
				predatorCount: simulationRuns.predatorCount,
			})
			.from(simulationRuns)
			.where(
				and(
					eq(simulationRuns.userId, userId),
					eq(simulationRuns.status, "saved"),
				),
			)
			.orderBy(desc(simulationRuns.startedAt));
	}),

	// S-10 (MS-07): mirrors listRunning/listSaved but for finished runs,
	// feeding the post-login dashboard's "Completed" section. `.limit(50)`
	// bounds an otherwise-unbounded list — same posture as the sample-array
	// caps elsewhere in this router.
	listCompleted: protectedProcedure.query(async ({ ctx }) => {
		const userId = ctx.session.user.id;
		if (!userId) {
			throw new TRPCError({ code: "UNAUTHORIZED" });
		}
		return ctx.db
			.select({
				id: simulationRuns.id,
				startedAt: simulationRuns.startedAt,
				boidCount: simulationRuns.boidCount,
				predatorCount: simulationRuns.predatorCount,
				score: simulationRuns.score,
				stoppedAt: simulationRuns.stoppedAt,
				// fix-default-start-failure Phase 3: surfaced so the dashboard can
				// badge a row the reconciliation sweep stopped, rather than it
				// blending in as an unexplained null-score stop.
				wasAutoStopped: simulationRuns.wasAutoStopped,
			})
			.from(simulationRuns)
			.where(
				and(
					eq(simulationRuns.userId, userId),
					eq(simulationRuns.status, "stopped"),
				),
			)
			.orderBy(desc(simulationRuns.startedAt))
			.limit(50);
	}),

	// leaderboard Phase 1: mirrors listCompleted but ranked by score for the
	// leaderboard page, scoped to the caller's own completed, scored runs —
	// same ownership/status filter as listCompleted, plus an isNotNull(score)
	// guard since a stopped run can have a null score (see listCompleted's
	// "includes a stopped row with a null score" test).
	listLeaderboard: protectedProcedure.query(async ({ ctx }) => {
		const userId = ctx.session.user.id;
		if (!userId) {
			throw new TRPCError({ code: "UNAUTHORIZED" });
		}
		const rows = await ctx.db
			.select({
				id: simulationRuns.id,
				startedAt: simulationRuns.startedAt,
				boidCount: simulationRuns.boidCount,
				predatorCount: simulationRuns.predatorCount,
				score: simulationRuns.score,
				stoppedAt: simulationRuns.stoppedAt,
				history: simulationRuns.history,
				// unwatched-run-tick-throttling Phase 3: surfaced so the client
				// can badge a run that isn't directly comparable to one that
				// never used this feature — same real-column treatment as
				// every other selected field here, unlike the derived
				// scoredWithAreaFactor below.
				wasEverThrottled: simulationRuns.wasEverThrottled,
				// per-tribe-food-config Phase 5: sibling to wasEverThrottled —
				// same real-column treatment, needed so ScoredRun.from below can
				// report the second, independent comparability reason.
				wasEverFoodImbalanced: simulationRuns.wasEverFoodImbalanced,
				// second-predator-tribe-prey-target Phase 3: sibling to
				// wasEverFoodImbalanced — same real-column treatment, needed so
				// ScoredRun.from below can report the third, independent
				// comparability reason.
				wasEverPredatorTribeImbalanced:
					simulationRuns.wasEverPredatorTribeImbalanced,
			})
			.from(simulationRuns)
			.where(
				and(
					eq(simulationRuns.userId, userId),
					eq(simulationRuns.status, "stopped"),
					isNotNull(simulationRuns.score),
				),
			)
			.orderBy(desc(simulationRuns.score), desc(simulationRuns.startedAt))
			.limit(50);

		return rows.map(
			({
				history,
				wasEverThrottled,
				wasEverFoodImbalanced,
				wasEverPredatorTribeImbalanced,
				...row
			}) => {
				const disclosure = pickComparability(
					ScoredRun.from({
						id: row.id,
						score: row.score,
						wasEverThrottled,
						wasEverFoodImbalanced,
						wasEverPredatorTribeImbalanced,
					}),
				);
				return {
					...row,
					scoredWithAreaFactor: Array.isArray(
						(history as { populationDensitySamples?: unknown } | null)
							?.populationDensitySamples,
					),
					comparable: disclosure.comparable,
					disclaimer: disclosure.disclaimer,
				};
			},
		);
	}),

	// parameter-suggestion-heuristic Phase 1: heuristic "try changing this
	// parameter" nudge for the staging page, scoped to the caller's own
	// completed runs — same ownership/status filter as `listCompleted`
	// above, `.limit(500)` sized larger since this reads 13 parameter
	// columns per row rather than the handful `listCompleted` selects.
	getParameterSuggestion: protectedProcedure.query(
		async ({ ctx }): Promise<ParameterSuggestion> => {
			const userId = ctx.session.user.id;
			if (!userId) {
				throw new TRPCError({ code: "UNAUTHORIZED" });
			}

			const rows = await ctx.db
				.select({
					score: simulationRuns.score,
					boidCount: simulationRuns.boidCount,
					separationWeight: simulationRuns.separationWeight,
					alignmentWeight: simulationRuns.alignmentWeight,
					cohesionWeight: simulationRuns.cohesionWeight,
					maxDurationSeconds: simulationRuns.maxDurationSeconds,
					predatorCount: simulationRuns.predatorCount,
					protectionThreshold: simulationRuns.protectionThreshold,
					foodStockInitial: simulationRuns.foodStockInitial,
					foodRegenRate: simulationRuns.foodRegenRate,
					flockCount: simulationRuns.flockCount,
					energyThreshold: simulationRuns.energyThreshold,
					mutationChance: simulationRuns.mutationChance,
					mutationMagnitude: simulationRuns.mutationMagnitude,
					xyArea: simulationRuns.xyArea,
					zDepth: simulationRuns.zDepth,
					// predator-tribe-concept Phase 1: sibling to `flockCount` above —
					// `SuggestionInputRow` now requires it (derived from
					// `TopLevelRangedParameterName`, which gained `predatorFlockCount`).
					predatorFlockCount: simulationRuns.predatorFlockCount,
					// unwatched-run-tick-throttling Phase 3: included so throttled
					// rows can be counted (flag-and-include, not excluded from
					// the correlation input) and disclosed in the rationale.
					wasEverThrottled: simulationRuns.wasEverThrottled,
					// per-tribe-food-config Phase 5: sibling to wasEverThrottled —
					// same real-column treatment, needed so ScoredRun.from below
					// can report the second, independent comparability reason.
					wasEverFoodImbalanced: simulationRuns.wasEverFoodImbalanced,
					// second-predator-tribe-prey-target Phase 3: sibling to
					// wasEverFoodImbalanced — same real-column treatment, needed
					// so ScoredRun.from below can report the third, independent
					// comparability reason.
					wasEverPredatorTribeImbalanced:
						simulationRuns.wasEverPredatorTribeImbalanced,
				})
				.from(simulationRuns)
				.where(
					and(
						eq(simulationRuns.userId, userId),
						eq(simulationRuns.status, "stopped"),
					),
				)
				.limit(500);

			// Defensive: `stopped` rows should always have a score, but
			// `startServer`'s catch-block failure path (above) can leave one
			// null — exclude rather than let `suggestParameterChange` see a
			// non-numeric score.
			const scoredRows = rows.filter(
				(row): row is typeof row & { score: number } => row.score !== null,
			);
			// `id: 0` is a placeholder — this query never selects a run id, and
			// only `comparable` is read below; `disclose()`'s per-run disclaimer
			// text is never surfaced at this call site.
			const disclosures = scoredRows.map((row) =>
				ScoredRun.from({
					id: 0,
					score: row.score,
					wasEverThrottled: row.wasEverThrottled,
					wasEverFoodImbalanced: row.wasEverFoodImbalanced,
					wasEverPredatorTribeImbalanced: row.wasEverPredatorTribeImbalanced,
				})?.disclose(),
			);
			const throttledCount = disclosures.filter(
				(d) => d && !d.comparable,
			).length;
			const inputRows: SuggestionInputRow[] = scoredRows.map(
				({
					wasEverThrottled,
					wasEverFoodImbalanced,
					wasEverPredatorTribeImbalanced,
					...row
				}) => ({
					...row,
					score: row.score,
				}),
			);

			return suggestParameterChange(inputRows, throttledCount);
		},
	),

	// S-11 (MS-08): a completed run's full stored data for the
	// run-analysis-view, plus two values computed server-side so the
	// client page never needs to import boids.ts (a server-only module).
	getRunAnalysis: protectedProcedure
		.input(z.object({ runId: z.number() }))
		.query(async ({ ctx, input }) => {
			const run = await ctx.db.query.simulationRuns.findFirst({
				where: (t, { eq: eqFn }) => eqFn(t.id, input.runId),
			});

			if (!run) {
				throw new TRPCError({ code: "BAD_REQUEST" });
			}
			if (run.userId !== ctx.session.user.id) {
				throw new TRPCError({ code: "FORBIDDEN" });
			}
			if (run.status !== "stopped") {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Run is not completed",
				});
			}

			// `history` is a schema-less JSON column — older rows may have
			// `null` (predate F-05) or lack `populationCountSamples`
			// (predate this change's Phase 1). Cast, don't assume.
			const rawHistory = run.history as {
				phaseHistory: PopulationPhase[];
				foodRatioSamples: number[];
				survivorGenes: BoidGenes[];
				populationCountSamples?: number[];
				geneticDiversitySamples?: number[];
				parameterChanges?: {
					tick: number;
					field: string;
					oldValue: number;
					newValue: number;
				}[];
			} | null;
			// impl-review (run-analysis-view): `history` is a schema-less JSON
			// column — the cast above is unchecked. Guard the required fields
			// too (not just the newer optional `populationCountSamples`), so a
			// legacy or hand-corrupted row degrades to the same "no data"
			// response the null case already gets, instead of throwing inside
			// segmentCompletedCycles/computeGeneticDiversity.
			const history =
				rawHistory &&
				Array.isArray(rawHistory.phaseHistory) &&
				Array.isArray(rawHistory.survivorGenes)
					? rawHistory
					: null;

			return {
				id: run.id,
				score: run.score,
				startedAt: run.startedAt,
				stoppedAt: run.stoppedAt,
				boidCount: run.boidCount,
				predatorCount: run.predatorCount,
				foodStockInitial: run.foodStockInitial,
				foodRegenRate: run.foodRegenRate,
				protectionThreshold: run.protectionThreshold,
				// fix-default-start-failure Phase 3: already present on the whole
				// row this `findFirst` fetched — surfaced here so the run-detail
				// page can render a notice when the reconciliation sweep (not
				// normal completion) is why this run stopped.
				wasAutoStopped: run.wasAutoStopped,
				history,
				completedCycles: history
					? segmentCompletedCycles(history.phaseHistory)
					: [],
				finalGeneticDiversity: history
					? computeGeneticDiversity(history.survivorGenes)
					: 0,
				runOptimizationSuggestion: history
					? suggestRunOptimization({
							phaseHistory: history.phaseHistory,
							predatorCount: run.predatorCount,
							foodStockInitial: run.foodStockInitial,
							foodRegenRate: run.foodRegenRate,
						})
					: ({ status: "insufficient-data" } as const),
			};
		}),

	// compare-runs-side-by-side Phase 1: fetches 2-4 of the caller's own
	// completed runs for the comparison view. Unlike getRunAnalysis (one
	// run, hard-fails on any gate), a bad id here (not found / not owned /
	// not completed) must not block the other N-1 runs, so each row is
	// resolved independently and a failure becomes a per-row `error`
	// marker in the result instead of a thrown TRPCError.
	getRunsComparison: protectedProcedure
		.input(z.object({ runIds: z.array(z.number()).min(2).max(4) }))
		.query(async ({ ctx, input }) => {
			const results: Array<
				| {
						runId: number;
						error: "not-found" | "forbidden" | "not-completed";
				  }
				| {
						runId: number;
						score: number | null;
						startedAt: Date;
						stoppedAt: Date | null;
						parameters: {
							boidCount: number;
							predatorCount: number;
							foodStockInitial: number;
							foodRegenRate: number;
							protectionThreshold: number;
						};
						breakdown: {
							survival: number;
							resourceManagement: number;
							geneticDiversity: number;
							phaseQuality: number;
							areaPopulationDensity: number | null;
							// second-predator-tribe-prey-target Phase 3: sibling to
							// areaPopulationDensity above — same optional-with-null
							// backward-compat posture for a row that predates this
							// factor.
							predatorTribeBalance: number | null;
						} | null;
						// ScoredRun.disclose()'s shape — see scored-run.ts. comparable
						// is true / disclaimer is null when the run has no score yet
						// (nothing to disclaim) or was never throttled.
						comparable: boolean;
						disclaimer: string | null;
						// fix-default-start-failure Phase 3: a real column, sibling to
						// wasEverThrottled above — surfaced so the compare page can
						// render its own distinct disclaimer ("stopped automatically"
						// is a different fact than "may not be directly comparable").
						wasAutoStopped: boolean;
				  }
			> = [];

			for (const runId of input.runIds) {
				const run = await ctx.db.query.simulationRuns.findFirst({
					where: (t, { eq: eqFn }) => eqFn(t.id, runId),
				});

				if (!run) {
					results.push({ runId, error: "not-found" });
					continue;
				}
				if (run.userId !== ctx.session.user.id) {
					results.push({ runId, error: "forbidden" });
					continue;
				}
				if (run.status !== "stopped") {
					results.push({ runId, error: "not-completed" });
					continue;
				}

				// `history` is a schema-less JSON column — same guarded-cast
				// posture as getRunAnalysis's, plus a check for
				// `elapsedSeconds` specifically: it's the one field this
				// phase newly adds, so it's the one field guaranteed absent
				// on every row that predates this change.
				const rawHistory = run.history as {
					phaseHistory: PopulationPhase[];
					foodRatioSamples: number[];
					// per-tribe-food-config Phase 5: optional, like
					// populationDensitySamples below — a row written before this
					// phase has no such key despite finishRun now always writing
					// one for every run stopped after this change.
					tribeFoodImbalanceSamples?: number[];
					survivorGenes: BoidGenes[];
					elapsedSeconds?: number;
					populationDensitySamples?: number[];
					// second-predator-tribe-prey-target Phase 3: optional, same
					// posture as populationDensitySamples above — a row
					// written before this phase has no such key.
					predatorTribeBalanceSamples?: number[];
				} | null;

				const breakdown =
					rawHistory &&
					Array.isArray(rawHistory.phaseHistory) &&
					Array.isArray(rawHistory.survivorGenes) &&
					typeof rawHistory.elapsedSeconds === "number"
						? {
								survival: rawHistory.elapsedSeconds,
								resourceManagement: computeResourceManagement(
									rawHistory.foodRatioSamples,
									Array.isArray(rawHistory.tribeFoodImbalanceSamples)
										? rawHistory.tribeFoodImbalanceSamples
										: [],
								),
								geneticDiversity: computeGeneticDiversity(
									rawHistory.survivorGenes,
								),
								phaseQuality: computePhaseQuality(rawHistory.phaseHistory),
								areaPopulationDensity: Array.isArray(
									rawHistory.populationDensitySamples,
								)
									? computeAreaPopulationDensity(
											rawHistory.populationDensitySamples,
										)
									: null,
								predatorTribeBalance: Array.isArray(
									rawHistory.predatorTribeBalanceSamples,
								)
									? computeAreaPredatorTribeBalance(
											rawHistory.predatorTribeBalanceSamples,
										)
									: null,
							}
						: null;

				results.push({
					runId,
					score: run.score,
					startedAt: run.startedAt,
					stoppedAt: run.stoppedAt,
					parameters: {
						boidCount: run.boidCount,
						predatorCount: run.predatorCount,
						foodStockInitial: run.foodStockInitial,
						foodRegenRate: run.foodRegenRate,
						protectionThreshold: run.protectionThreshold,
					},
					breakdown,
					...pickComparability(
						ScoredRun.from({
							id: run.id,
							score: run.score,
							wasEverThrottled: run.wasEverThrottled,
							wasEverFoodImbalanced: run.wasEverFoodImbalanced,
							wasEverPredatorTribeImbalanced:
								run.wasEverPredatorTribeImbalanced,
						}),
					),
					wasAutoStopped: run.wasAutoStopped,
				});
			}

			return results;
		}),

	// live-parameter-adjustment (S-27): patch a batch of live-adjustable
	// fields on a running server-owned simulation. Validation is
	// deliberately soft — an out-of-range value still applies, accompanied
	// by a warning (decision 1 in plan.md's Overview) — unlike
	// `checkAgainstAdminRanges`, which rejects `start`/`startServer`
	// outright. The ownership/active-run check mirrors `savePause` exactly.
	updateRunParams: protectedProcedure
		.input(
			z.object({
				runId: z.number(),
				foodRegenRate: z.number().finite().nonnegative().optional(),
				protectionThreshold: z.number().int().nonnegative().optional(),
				energyThreshold: z.number().finite().positive().optional(),
				mutationChance: z.number().min(0).max(1).optional(),
				mutationMagnitude: z.number().min(0).max(1).optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const { runId, ...patch } = input;
			if (Object.keys(patch).length === 0) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "No fields to update",
				});
			}
			const run = await ctx.db.query.simulationRuns.findFirst({
				where: (t, { eq: eqFn }) => eqFn(t.id, runId),
			});
			if (!run) {
				throw new TRPCError({ code: "BAD_REQUEST" });
			}
			if (run.userId !== ctx.session.user.id) {
				throw new TRPCError({ code: "FORBIDDEN" });
			}
			if (run.status !== "running" || !isServerRunActive(runId)) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Run is not an active server-run simulation",
				});
			}
			const { parameterRanges } = await getOrSeedAdminSettings(ctx.db);
			const numericPatch = Object.fromEntries(
				Object.entries(patch).map(([k, v]) => [
					k,
					typeof v === "boolean" ? Number(v) : v,
				]),
			);
			const warnings = checkLiveParamRangesSoft(numericPatch, parameterRanges);
			const result = applyLiveParams(runId, patch);
			if (result.status === "not-found") {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Run is no longer active",
				});
			}
			// impl-review (live-parameter-adjustment, F1): the client's own
			// Apply cooldown is UI-only and doesn't stop a direct call from
			// pushing unbounded `parameterChanges` entries — this is the real
			// gate. A well-behaved client never hits it in practice.
			if (result.status === "throttled") {
				throw new TRPCError({
					code: "TOO_MANY_REQUESTS",
					message: `Try again in ${result.retryAfterMs}ms`,
				});
			}
			return { ok: true, warnings };
		}),

	// per-tribe-behavior-weights Phase 6: a dedicated live-edit mutation for
	// `tribeConfigs`, mirroring `updateRunParams`'s ownership/active-run
	// check shape exactly, but validated against the same per-tribe shape
	// `start`/`startServer` validate at creation time (`tribeConfigSchema`)
	// rather than `updateRunParams`'s per-field-optional patch shape — an
	// array field replaces wholesale, it isn't patched field-by-field.
	// Range validation is soft (warn, don't block), same posture as
	// `updateRunParams`/`adjustLivePopulation`'s existing live-edit paths —
	// only the length-matches-flockCount check is hard, since a length
	// mismatch would silently misindex `tribeConfigs[boid.genes.flockId]`
	// reads elsewhere (boids.ts), not merely tune a soft bound.
	updateTribeConfigs: protectedProcedure
		.input(
			z.object({
				runId: z.number(),
				tribeConfigs: z.array(tribeConfigSchema).min(1),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const run = await ctx.db.query.simulationRuns.findFirst({
				where: (t, { eq: eqFn }) => eqFn(t.id, input.runId),
			});
			if (!run) {
				throw new TRPCError({ code: "BAD_REQUEST" });
			}
			if (run.userId !== ctx.session.user.id) {
				throw new TRPCError({ code: "FORBIDDEN" });
			}
			if (run.status !== "running" || !isServerRunActive(input.runId)) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Run is not an active server-run simulation",
				});
			}
			if (input.tribeConfigs.length !== run.flockCount) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: `tribeConfigs must have exactly ${run.flockCount} entries (one per flock), got ${input.tribeConfigs.length}`,
				});
			}

			const { parameterRanges } = await getOrSeedAdminSettings(ctx.db);
			const warnings: string[] = [];
			for (const [index, tribeConfig] of input.tribeConfigs.entries()) {
				for (const name of TRIBE_RANGED_FIELD_NAMES) {
					const value = tribeConfig[name];
					const range = parameterRanges[name];
					if (value < range.min || value > range.max) {
						warnings.push(
							`tribe ${index}: ${name} (${value}) is outside the configured range ${range.min}-${range.max}`,
						);
					}
				}
			}

			const result = applyLiveTribeConfigs(input.runId, input.tribeConfigs);
			if (result.status === "not-found") {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Run is no longer active",
				});
			}
			if (result.status === "throttled") {
				throw new TRPCError({
					code: "TOO_MANY_REQUESTS",
					message: `Try again in ${result.retryAfterMs}ms`,
				});
			}
			return { ok: true, warnings };
		}),

	// predator-tribe-concept Phase 5: a dedicated live-edit mutation for
	// `predatorTribeConfigs`, mirroring `updateTribeConfigs`'s exact
	// ownership/active-run/length/soft-range-check shape — only the length
	// check is against `predatorFlockCount` (this run's own independent
	// predator-tribe count) rather than `flockCount`, and the soft range
	// check loops `PREDATOR_TRIBE_RANGED_FIELD_NAMES` rather than
	// `TRIBE_RANGED_FIELD_NAMES`.
	updatePredatorTribeConfigs: protectedProcedure
		.input(
			z.object({
				runId: z.number(),
				predatorTribeConfigs: z.array(predatorTribeConfigSchema).min(1),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const run = await ctx.db.query.simulationRuns.findFirst({
				where: (t, { eq: eqFn }) => eqFn(t.id, input.runId),
			});
			if (!run) {
				throw new TRPCError({ code: "BAD_REQUEST" });
			}
			if (run.userId !== ctx.session.user.id) {
				throw new TRPCError({ code: "FORBIDDEN" });
			}
			if (run.status !== "running" || !isServerRunActive(input.runId)) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Run is not an active server-run simulation",
				});
			}
			if (input.predatorTribeConfigs.length !== run.predatorFlockCount) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: `predatorTribeConfigs must have exactly ${run.predatorFlockCount} entries (one per predator flock), got ${input.predatorTribeConfigs.length}`,
				});
			}

			const { parameterRanges } = await getOrSeedAdminSettings(ctx.db);
			const warnings: string[] = [];
			for (const [index, tribeConfig] of input.predatorTribeConfigs.entries()) {
				for (const name of PREDATOR_TRIBE_RANGED_FIELD_NAMES) {
					const value = tribeConfig[name];
					const range = parameterRanges[name];
					if (value < range.min || value > range.max) {
						warnings.push(
							`predator tribe ${index}: ${name} (${value}) is outside the configured range ${range.min}-${range.max}`,
						);
					}
				}
			}

			const result = applyLivePredatorTribeConfigs(
				input.runId,
				input.predatorTribeConfigs,
			);
			if (result.status === "not-found") {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Run is no longer active",
				});
			}
			if (result.status === "throttled") {
				throw new TRPCError({
					code: "TOO_MANY_REQUESTS",
					message: `Try again in ${result.retryAfterMs}ms`,
				});
			}
			return { ok: true, warnings };
		}),

	// live-boid-count-adjustment Phase 2: the router-level entry point for a
	// population step-button click — mirrors `updateRunParams`'s
	// ownership/active-run check shape exactly. Validation is soft, same
	// posture as `updateRunParams`: an out-of-range resulting count still
	// applies, accompanied by warnings.
	adjustLivePopulation: protectedProcedure
		.input(
			z.object({
				runId: z.number(),
				field: z.enum(["boidCount", "predatorCount"]),
				delta: z.number().int(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const run = await ctx.db.query.simulationRuns.findFirst({
				where: (t, { eq: eqFn }) => eqFn(t.id, input.runId),
			});
			if (!run) {
				throw new TRPCError({ code: "BAD_REQUEST" });
			}
			if (run.userId !== ctx.session.user.id) {
				throw new TRPCError({ code: "FORBIDDEN" });
			}
			if (run.status !== "running" || !isServerRunActive(input.runId)) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Run is not an active server-run simulation",
				});
			}

			const liveState = getLiveRunState(input.runId);
			if (!liveState) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Run is no longer active",
				});
			}
			const kind = input.field === "boidCount" ? "boid" : "predator";
			const currentCount =
				kind === "boid" ? liveState.boids.length : liveState.predators.length;
			const otherFieldCount =
				kind === "boid" ? liveState.predators.length : liveState.boids.length;
			const newCount = Math.max(0, currentCount + input.delta);

			const { parameterRanges, maxObjectCount, maxConcurrentObjectCount } =
				await getOrSeedAdminSettings(ctx.db);

			const warnings = checkLiveParamRangesSoft(
				{ [input.field]: newCount },
				parameterRanges,
			);
			const perRunWarning = checkPerRunObjectCapSoft(
				otherFieldCount,
				newCount,
				maxObjectCount,
			);
			if (perRunWarning) {
				warnings.push(perRunWarning);
			}
			const concurrentWarning = await checkConcurrentObjectCapSoft(
				ctx.db,
				run.userId,
				newCount + otherFieldCount,
				input.runId,
				maxConcurrentObjectCount,
			);
			if (concurrentWarning) {
				warnings.push(concurrentWarning);
			}

			const result = adjustLivePopulationRegistry(
				input.runId,
				kind,
				input.delta,
			);
			if (result.status === "not-found") {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Run is no longer active",
				});
			}
			if (result.status === "throttled") {
				throw new TRPCError({
					code: "TOO_MANY_REQUESTS",
					message: `Try again in ${result.retryAfterMs}ms`,
				});
			}

			return { ok: true, warnings, newCount };
		}),

	// S-04 Phase 4 (FR-012): pause a live server-owned run into a resumable
	// "saved" row — distinct from `stop`, which is terminal and scores
	// immediately. Only server-owned runs have a live registry entry to
	// snapshot; the client-staged path is untouched by this action.
	savePause: protectedProcedure
		.input(z.object({ runId: z.number() }))
		.mutation(async ({ ctx, input }) => {
			const run = await ctx.db.query.simulationRuns.findFirst({
				where: (simulationRuns, { eq }) => eq(simulationRuns.id, input.runId),
			});

			if (!run) {
				throw new TRPCError({ code: "BAD_REQUEST" });
			}
			if (run.userId !== ctx.session.user.id) {
				throw new TRPCError({ code: "FORBIDDEN" });
			}
			if (run.status !== "running" || !isServerRunActive(input.runId)) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Run is not an active server-run simulation",
				});
			}

			const snapshot = snapshotServerRun(input.runId);
			if (!snapshot) {
				throw new TRPCError({ code: "BAD_REQUEST" });
			}

			// Race-safety net, same shape as `stop`'s: the snapshot above has
			// already pulled this run out of the live registry (it cannot be
			// un-paused in-memory), so a losing race here — someone else's
			// `stop`/`savePause` already changed the row's status — leaves it
			// stuck at whatever that other write set, untracked by this
			// snapshot. Logged loudly rather than silently retried, same
			// accepted-gap posture as `finishRun`'s own comment.
			const [saved] = await ctx.db
				.update(simulationRuns)
				.set({
					status: "saved",
					savedState: snapshot,
				})
				.where(
					and(
						eq(simulationRuns.id, input.runId),
						eq(simulationRuns.status, "running"),
					),
				)
				.returning({ id: simulationRuns.id });

			if (!saved) {
				console.error(
					`savePause: run ${input.runId} was snapshotted but its row's status changed before the write landed — snapshot discarded, live run was already removed from the registry`,
				);
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Run already stopped or saved",
				});
			}

			return { ok: true };
		}),

	// S-04 Phase 4 (FR-012): the `savePause` counterpart — reconstructs the
	// live registry entry from `savedState` and flips the row back to
	// "running", exactly as `startServer` does for a fresh run.
	resume: protectedProcedure
		.input(z.object({ runId: z.number() }))
		.mutation(async ({ ctx, input }) => {
			const run = await ctx.db.query.simulationRuns.findFirst({
				where: (simulationRuns, { eq }) => eq(simulationRuns.id, input.runId),
			});

			if (!run) {
				throw new TRPCError({ code: "BAD_REQUEST" });
			}
			if (run.userId !== ctx.session.user.id) {
				throw new TRPCError({ code: "FORBIDDEN" });
			}
			if (run.status !== "saved" || !run.savedState) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Run is not in a saved state",
				});
			}

			await assertWithinConcurrentObjectCeiling(
				ctx.db,
				run.userId,
				run.boidCount + run.predatorCount,
				run.id,
			);

			try {
				resumeServerRun(input.runId, run.savedState as ServerRunSnapshot);
			} catch (error) {
				console.error(
					`resume: resumeServerRun failed for run ${input.runId}:`,
					error,
				);
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: "Failed to resume the saved simulation",
				});
			}

			const [resumed] = await ctx.db
				.update(simulationRuns)
				.set({ status: "running", savedState: null })
				.where(
					and(
						eq(simulationRuns.id, input.runId),
						eq(simulationRuns.status, "saved"),
					),
				)
				.returning({ id: simulationRuns.id });

			if (!resumed) {
				console.error(
					`resume: run ${input.runId} was reconstructed into the live registry but its row's status changed before the write landed`,
				);
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Run is no longer in a saved state",
				});
			}

			return { ok: true };
		}),

	// S-04 (FR-002 full): any logged-in user can read the current ranges
	// (needed to render the start form's bounds); only an admin can change
	// them. First real usage of `adminProcedure` anywhere in this codebase.
	getParameterRanges: protectedProcedure.query(async ({ ctx }) => {
		return getOrSeedAdminSettings(ctx.db);
	}),

	updateParameterRanges: adminProcedure
		.input(
			z.object({
				parameterRanges: z.record(
					z.enum(RANGED_PARAMETER_NAMES),
					z.object({
						min: z.number().finite(),
						max: z.number().finite(),
						default: z.number().finite(),
					}),
				),
				maxObjectCount: z.number().int().positive(),
				maxConcurrentObjectCount: z.number().int().positive(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			for (const name of RANGED_PARAMETER_NAMES) {
				const range = input.parameterRanges[name];
				if (!range || range.min > range.default || range.default > range.max) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: `${name}: range must satisfy min <= default <= max`,
					});
				}
			}
			await ctx.db
				.insert(adminSettings)
				.values({
					id: ADMIN_SETTINGS_ID,
					parameterRanges: input.parameterRanges,
					maxObjectCount: input.maxObjectCount,
					maxConcurrentObjectCount: input.maxConcurrentObjectCount,
				})
				.onConflictDoUpdate({
					target: adminSettings.id,
					set: {
						parameterRanges: input.parameterRanges,
						maxObjectCount: input.maxObjectCount,
						maxConcurrentObjectCount: input.maxConcurrentObjectCount,
					},
				});
			return { ok: true };
		}),
});
