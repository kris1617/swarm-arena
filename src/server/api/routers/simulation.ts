import { TRPCError, tracked } from "@trpc/server";
import { and, count, desc, eq, isNotNull } from "drizzle-orm";
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
	computeGeneticDiversity,
	computePhaseQuality,
	computeResourceManagement,
	computeScore,
	type PopulationPhase,
	segmentCompletedCycles,
} from "~/server/simulation/boids";
import {
	checkLiveParamRangesSoft,
	DEFAULT_MAX_CONCURRENT_OBJECT_COUNT,
	DEFAULT_MAX_OBJECT_COUNT,
	DEFAULT_PARAMETER_RANGES,
	type ParameterRanges,
	RANGED_PARAMETER_NAMES,
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
	crossbreedingEnabled: z.boolean(),
	energyThreshold: z.number().finite().positive(),
	mutationChance: z.number().min(0).max(1),
	mutationMagnitude: z.number().min(0).max(1),
	// S-24: the run's configured spatial extent — validated via the same
	// generic checkAgainstAdminRanges loop as every other ranged parameter.
	xyArea: z.number().int().positive(),
	zDepth: z.number().int().positive(),
});

// Singleton row id for `adminSettings` — see schema.ts's comment on the
// table for why this is an application-layer convention, not a DB
// constraint.
const ADMIN_SETTINGS_ID = 1;

async function getOrSeedAdminSettings(db: typeof dbSingleton): Promise<{
	parameterRanges: ParameterRanges;
	maxObjectCount: number;
	maxConcurrentObjectCount: number;
}> {
	const existing = await db.query.adminSettings.findFirst({
		where: (t, { eq: eqFn }) => eqFn(t.id, ADMIN_SETTINGS_ID),
	});
	if (existing) {
		return {
			parameterRanges: existing.parameterRanges as ParameterRanges,
			maxObjectCount: existing.maxObjectCount,
			maxConcurrentObjectCount: existing.maxConcurrentObjectCount,
		};
	}
	// First-run seed: insert the default row matching the pre-S-04 hardcoded
	// bounds exactly, so nothing changes in practice until an admin edits it.
	await db.insert(adminSettings).values({
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
	for (const name of RANGED_PARAMETER_NAMES) {
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
}

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
): Promise<{ runId: number; seed: number }> {
	const { parameterRanges, maxObjectCount } = await getOrSeedAdminSettings(db);
	checkAgainstAdminRanges(input, parameterRanges, maxObjectCount);

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
			crossbreedingEnabled: input.crossbreedingEnabled,
			energyThreshold: input.energyThreshold,
			mutationChance: input.mutationChance,
			mutationMagnitude: input.mutationMagnitude,
			xyArea: input.xyArea,
			zDepth: input.zDepth,
			status: "running",
		})
		.returning({ id: simulationRuns.id });

	if (!run) {
		throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
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
			return insertRunningSimulation(ctx.db, userId, input);
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
							field: z.enum(RANGED_PARAMETER_NAMES),
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
				computeResourceManagement(input.foodRatioSamples),
				computeGeneticDiversity(input.survivingBoidGenes),
				computePhaseQuality(input.phaseHistory),
				computeAreaPopulationDensity(input.populationDensitySamples),
			);

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
					// F-05 (MS-08): persist alongside the score instead of
					// discarding — matches server-run-registry.ts's finishRun.
					history: {
						phaseHistory: input.phaseHistory,
						foodRatioSamples: input.foodRatioSamples,
						survivorGenes: input.survivingBoidGenes,
						populationCountSamples: input.populationCountSamples,
						populationDensitySamples: input.populationDensitySamples,
						geneticDiversitySamples: input.geneticDiversitySamples,
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

		return rows.map(({ history, wasEverThrottled, ...row }) => {
			const disclosure = pickComparability(
				ScoredRun.from({ id: row.id, score: row.score, wasEverThrottled }),
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
		});
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
					crossbreedingEnabled: simulationRuns.crossbreedingEnabled,
					energyThreshold: simulationRuns.energyThreshold,
					mutationChance: simulationRuns.mutationChance,
					mutationMagnitude: simulationRuns.mutationMagnitude,
					xyArea: simulationRuns.xyArea,
					zDepth: simulationRuns.zDepth,
					// unwatched-run-tick-throttling Phase 3: included so throttled
					// rows can be counted (flag-and-include, not excluded from
					// the correlation input) and disclosed in the rationale.
					wasEverThrottled: simulationRuns.wasEverThrottled,
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
				})?.disclose(),
			);
			const throttledCount = disclosures.filter(
				(d) => d && !d.comparable,
			).length;
			const inputRows: SuggestionInputRow[] = scoredRows.map(
				({ wasEverThrottled, ...row }) => ({ ...row, score: row.score }),
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
					survivorGenes: BoidGenes[];
					elapsedSeconds?: number;
					populationDensitySamples?: number[];
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
				crossbreedingEnabled: z.boolean().optional(),
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
