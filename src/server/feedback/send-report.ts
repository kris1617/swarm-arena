// in-app-feedback-module (roadmap S-26): the single place that calls
// `createGithubIssue` for an existing `feedback_reports` row and updates
// that row's status/attempt bookkeeping accordingly — shared by the
// router's immediate attempt (Phase 2) and the retry worker's scheduled
// attempts (Phase 3), so this "call GitHub, then update the row" logic
// exists exactly once, never duplicated between the two callers.

import { eq } from "drizzle-orm";
import type { db as dbSingleton } from "~/server/db";
import { feedbackReports } from "~/server/db/schema";
import {
	createGithubIssue,
	formatIssueTitle,
	GithubApiError,
	mapCategoryToGithubLabel,
} from "~/server/feedback/github-client";

// Exported so Phase 3's retry worker can reference the same cap when
// deciding whether a row has exhausted its retry budget.
export const MAX_RETRY_ATTEMPTS = 5;

// Hardcoded — this app only ever deploys from this one repo (plan's "What
// We're NOT Doing": not making the owner/repo configurable).
const GITHUB_OWNER = "kris1617";
const GITHUB_REPO = "swarm-arena";

// Takes `db` as an explicit parameter (the exact `ctx.db` instance), never
// the module-level singleton — see context/foundation/lessons.md's "tRPC
// router helpers must take ctx.db as a parameter" rule: a future test
// injecting a sabotaging/fake db (the way simulation.test.ts already does
// for insertRunningSimulation) would otherwise be silently bypassed.
export async function attemptSendReport(
	db: typeof dbSingleton,
	reportId: number,
	token: string,
): Promise<{ sent: true; issueUrl: string } | { sent: false }> {
	const report = await db.query.feedbackReports.findFirst({
		where: (t, { eq: eqFn }) => eqFn(t.id, reportId),
	});

	// Defensive — should not normally happen (the caller just inserted this
	// row), but there's no row to update if it doesn't exist.
	if (!report) {
		return { sent: false };
	}

	const user = await db.query.users.findFirst({
		where: (t, { eq: eqFn }) => eqFn(t.id, report.userId),
	});

	const body = `${report.description}\n\n---\nReported from: ${report.pagePath}\nUser agent: ${report.userAgent}\nReporter: ${user?.email ?? "unknown"}`;
	const title = formatIssueTitle(report.category, report.title);
	const labels = [mapCategoryToGithubLabel(report.category)];

	try {
		const result = await createGithubIssue(
			{ token, owner: GITHUB_OWNER, repo: GITHUB_REPO, title, body, labels },
			fetch,
		);

		await db
			.update(feedbackReports)
			.set({
				status: "sent",
				githubIssueNumber: result.issueNumber,
				githubIssueUrl: result.issueUrl,
				lastAttemptAt: new Date(),
			})
			.where(eq(feedbackReports.id, reportId));

		return { sent: true, issueUrl: result.issueUrl };
	} catch (error) {
		// A failed send is an expected, handled outcome per the plan, not an
		// exceptional one propagating to the caller — never rethrow.
		const newAttemptCount = report.attemptCount + 1;
		const lastError =
			error instanceof GithubApiError
				? error.body
				: error instanceof Error
					? error.message
					: String(error);

		await db
			.update(feedbackReports)
			.set({
				status: newAttemptCount >= MAX_RETRY_ATTEMPTS ? "abandoned" : "pending",
				attemptCount: newAttemptCount,
				lastError,
				lastAttemptAt: new Date(),
			})
			.where(eq(feedbackReports.id, reportId));

		return { sent: false };
	}
}
