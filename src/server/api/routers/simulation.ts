import { TRPCError, tracked } from "@trpc/server";
import { and, count, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import type { db as dbSingleton } from "~/server/db";
import { simulationRuns } from "~/server/db/schema";
import { computeScore } from "~/server/simulation/boids";
// Shared cap on how many simulations (staging or server-run) a user may
// have running at once, across every start path.
import { MAX_PARALLEL_RUNS } from "~/server/simulation/run-slots";
import {
	startServerRun,
	watchServerRun,
} from "~/server/simulation/server-run-registry";

const startInputSchema = z
	.object({
		boidCount: z.number().int().positive().max(500),
		separationWeight: z.number().finite(),
		alignmentWeight: z.number().finite(),
		cohesionWeight: z.number().finite(),
		// .max(600) (10 min) closes an unbounded-run resource surface —
		// matches the spirit of boidCount's own .max(500).
		maxDurationSeconds: z.number().int().positive().max(600),
		predatorCount: z.number().int().nonnegative().max(500),
		protectionThreshold: z.number().int().nonnegative().max(500),
		foodStockInitial: z.number().finite().positive(),
		foodRegenRate: z.number().finite().nonnegative(),
		flockCount: z.number().int().min(2).max(4),
		crossbreedingEnabled: z.boolean(),
		energyThreshold: z.number().finite().positive(),
		mutationChance: z.number().min(0).max(1),
		mutationMagnitude: z.number().min(0).max(1),
	})
	.refine((input) => input.boidCount + input.predatorCount <= 500, {
		message: "boidCount + predatorCount must not exceed 500",
		path: ["predatorCount"],
	});

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

			const clampedElapsedTicks = Math.min(
				input.elapsedTicks,
				run.maxDurationSeconds + 1,
			);

			const score = computeScore(input.cohesionSamples, clampedElapsedTicks);

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
});
