import { TRPCError, tracked } from "@trpc/server";
import { and, count, desc, eq } from "drizzle-orm";
import { z } from "zod";

import {
	adminProcedure,
	createTRPCRouter,
	protectedProcedure,
} from "~/server/api/trpc";
import type { db as dbSingleton } from "~/server/db";
import { adminSettings, simulationRuns } from "~/server/db/schema";
import {
	computeGeneticDiversity,
	computePhaseQuality,
	computeResourceManagement,
	computeScore,
} from "~/server/simulation/boids";
import {
	DEFAULT_MAX_OBJECT_COUNT,
	DEFAULT_PARAMETER_RANGES,
	type ParameterRanges,
	RANGED_PARAMETER_NAMES,
} from "~/server/simulation/parameter-ranges";
// Shared cap on how many simulations (staging or server-run) a user may
// have running at once, across every start path.
import { MAX_PARALLEL_RUNS } from "~/server/simulation/run-slots";
import {
	isServerRunActive,
	resumeServerRun,
	type ServerRunSnapshot,
	snapshotServerRun,
	startServerRun,
	watchServerRun,
} from "~/server/simulation/server-run-registry";

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
});

// Singleton row id for `adminSettings` — see schema.ts's comment on the
// table for why this is an application-layer convention, not a DB
// constraint.
const ADMIN_SETTINGS_ID = 1;

async function getOrSeedAdminSettings(
	db: typeof dbSingleton,
): Promise<{ parameterRanges: ParameterRanges; maxObjectCount: number }> {
	const existing = await db.query.adminSettings.findFirst({
		where: (t, { eq: eqFn }) => eqFn(t.id, ADMIN_SETTINGS_ID),
	});
	if (existing) {
		return {
			parameterRanges: existing.parameterRanges as ParameterRanges,
			maxObjectCount: existing.maxObjectCount,
		};
	}
	// First-run seed: insert the default row matching the pre-S-04 hardcoded
	// bounds exactly, so nothing changes in practice until an admin edits it.
	await db.insert(adminSettings).values({
		id: ADMIN_SETTINGS_ID,
		parameterRanges: DEFAULT_PARAMETER_RANGES,
		maxObjectCount: DEFAULT_MAX_OBJECT_COUNT,
	});
	return {
		parameterRanges: DEFAULT_PARAMETER_RANGES,
		maxObjectCount: DEFAULT_MAX_OBJECT_COUNT,
	};
}

function checkAgainstAdminRanges(
	input: z.infer<typeof startInputSchema>,
	ranges: ParameterRanges,
	maxObjectCount: number,
): void {
	for (const name of RANGED_PARAMETER_NAMES) {
		const value = input[name];
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
				})
				.onConflictDoUpdate({
					target: adminSettings.id,
					set: {
						parameterRanges: input.parameterRanges,
						maxObjectCount: input.maxObjectCount,
					},
				});
			return { ok: true };
		}),
});
