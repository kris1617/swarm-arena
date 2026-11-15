// in-app-feedback-module (roadmap S-26): lets any signed-in user submit a
// bug/idea report, enforced from the DB (not in-memory) rate limit, insert
// the row, and attempt an immediate send via send-report.ts's shared
// helper.

import { TRPCError } from "@trpc/server";
import { and, count, eq, gt } from "drizzle-orm";
import { z } from "zod";

import { env } from "~/env";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { feedbackReports } from "~/server/db/schema";
import { attemptSendReport } from "~/server/feedback/send-report";

// No more than this many reports per user in a rolling hour, counted
// directly off `feedback_reports` rather than a separate counter table —
// same table doubles as the rate-limit source, per the plan.
const MAX_REPORTS_PER_HOUR = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 60_000;

export const feedbackRouter = createTRPCRouter({
	create: protectedProcedure
		.input(
			z.object({
				category: z.enum(["bug", "idea"]),
				title: z.string().min(1).max(200),
				description: z.string().min(1).max(5000),
				pagePath: z.string().min(1).max(200),
				userAgent: z.string().max(500),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const userId = ctx.session.user.id;
			const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MS);

			const [recentRow] = await ctx.db
				.select({ recentCount: count() })
				.from(feedbackReports)
				.where(
					and(
						eq(feedbackReports.userId, userId),
						gt(feedbackReports.createdAt, windowStart),
					),
				);
			const recentCount = recentRow?.recentCount ?? 0;
			if (recentCount >= MAX_REPORTS_PER_HOUR) {
				throw new TRPCError({
					code: "TOO_MANY_REQUESTS",
					message:
						"You've submitted too many reports in the last hour — please try again later.",
				});
			}

			const [newRow] = await ctx.db
				.insert(feedbackReports)
				.values({
					userId,
					category: input.category,
					title: input.title,
					description: input.description,
					pagePath: input.pagePath,
					userAgent: input.userAgent,
				})
				.returning({ id: feedbackReports.id });

			if (!newRow) {
				throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
			}

			const result = await attemptSendReport(
				ctx.db,
				newRow.id,
				env.GITHUB_FEEDBACK_TOKEN,
			);

			return result.sent
				? { status: "sent" as const, issueUrl: result.issueUrl }
				: { status: "queued" as const };
		}),
});
