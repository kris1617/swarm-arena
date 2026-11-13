import { TRPCError } from "@trpc/server";
import { and, count, eq } from "drizzle-orm";
import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { simulationRuns } from "~/server/db/schema";
import { computeScore } from "~/server/simulation/boids";
// S-05 (parallel-sim-switching): the client-side run-slot manager already
// caps a single browser session at MAX_PARALLEL_RUNS, but that's UI-only —
// a second tab or a direct API call would bypass it without this check.
import { MAX_PARALLEL_RUNS } from "~/server/simulation/run-slots";

export const simulationRouter = createTRPCRouter({
	start: protectedProcedure
		.input(
			z
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
				})
				.refine((input) => input.boidCount + input.predatorCount <= 500, {
					message: "boidCount + predatorCount must not exceed 500",
					path: ["predatorCount"],
				}),
		)
		.mutation(async ({ ctx, input }) => {
			const userId = ctx.session.user.id;
			if (!userId) {
				throw new TRPCError({ code: "UNAUTHORIZED" });
			}

			const [runningCountRow] = await ctx.db
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

			const [run] = await ctx.db
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
					status: "running",
				})
				.returning({ id: simulationRuns.id });

			if (!run) {
				throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
			}

			// Race-safety net: a concurrent `start` call can pass the count
			// check above before either insert lands, breaching the cap. Catch
			// it immediately after this insert and invalidate the row this call
			// just created rather than trusting the pre-insert count alone.
			const [recheckRow] = await ctx.db
				.select({ runningCount: count() })
				.from(simulationRuns)
				.where(
					and(
						eq(simulationRuns.userId, userId),
						eq(simulationRuns.status, "running"),
					),
				);
			if ((recheckRow?.runningCount ?? 0) > MAX_PARALLEL_RUNS) {
				await ctx.db
					.update(simulationRuns)
					.set({ status: "stopped" })
					.where(eq(simulationRuns.id, run.id));
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: `Already running ${MAX_PARALLEL_RUNS} simulations — stop one before starting another.`,
				});
			}

			return { runId: run.id, seed };
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
});
