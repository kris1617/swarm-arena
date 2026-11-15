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

	// impl-review F3: the auto-attached context leads, the user's own text
	// trails — a description containing its own fake "Reported from"/
	// "Reporter" lines then reads as part of the user's text rather than
	// impersonating this footer's position.
	const body = `Reported from: ${report.pagePath}\nUser agent: ${report.userAgent}\nReporter: ${user?.email ?? "unknown"}\n\n---\n\n${report.description}`;
	const title = formatIssueTitle(report.category, report.title);
	const labels = [mapCategoryToGithubLabel(report.category)];

	// impl-review F1: only the external call is inside this try/catch. The
	// success-path DB write below is deliberately OUTSIDE it — if GitHub
	// already created the issue but persisting that fact fails (e.g. a
	// transient SQLite busy error), that is an infrastructure failure, not a
	// send failure, and must not be reclassified as one: doing so would flip
	// status back to "pending"/"abandoned" with no githubIssueNumber/Url
	// recorded, and the retry worker would file a duplicate issue for the
	// same report on its next tick. Letting it propagate instead (caught by
	// retry-worker.ts's per-row try/catch, or tRPC's own error path for the
	// router's immediate attempt) is the correct failure mode here.
	let result: { issueNumber: number; issueUrl: string };
	try {
		result = await createGithubIssue(
			{ token, owner: GITHUB_OWNER, repo: GITHUB_REPO, title, body, labels },
			fetch,
		);
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

	// GitHub already has the issue at this point — a failure here is a DB
	// infrastructure problem, not a send failure (see the comment above the
	// try block), so it propagates to the caller rather than being swallowed.
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
}
