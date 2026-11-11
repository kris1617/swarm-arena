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
					maxDurationSeconds: z.number().int().positive(),
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

			return { runId: run.id, seed };
		}),

	stop: protectedProcedure
		.input(
			z.object({
				runId: z.number(),
				elapsedTicks: z.number().nonnegative(),
				cohesionSamples: z.array(z.number().min(0).max(1)).min(1),
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

			await ctx.db
				.update(simulationRuns)
				.set({
					status: "stopped",
					score,
					stoppedAt: new Date(),
				})
				.where(eq(simulationRuns.id, input.runId));

			return { score };
		}),
});
