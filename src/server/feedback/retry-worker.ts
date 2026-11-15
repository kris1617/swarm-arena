// in-app-feedback-module (roadmap S-26) Phase 3: a single global interval,
// started once at server boot, that retries every report still in
// "pending" status — Phase 2's attemptSendReport leaves a row "pending" on
// failure until MAX_RETRY_ATTEMPTS is hit, at which point it flips to
// "abandoned" and this worker stops picking it up.
//
// Unlike send-report.ts's attemptSendReport (which takes `db` as a
// parameter so callers can inject a test double), this module's
// startFeedbackRetryWorker is the actual production entry point that owns
// the real interval — so it reads the real `db`/`env` singletons directly,
// exactly the way server-run-registry.ts does for its own ticking.

import { asc, eq } from "drizzle-orm";

import { env } from "~/env";
import { db } from "~/server/db";
import { feedbackReports } from "~/server/db/schema";
import { attemptSendReport } from "~/server/feedback/send-report";

// Exported so the test file can advance fake timers by exactly this amount
// without duplicating the literal.
export const RETRY_INTERVAL_MS = 5 * 60_000;

// At most this many rows per tick — a low-volume hobby-project queue, kept
// small and sent sequentially (never Promise.all) so a cold start with
// several queued rows doesn't burst GitHub's rate limit.
const MAX_ROWS_PER_TICK = 10;

// Cached on globalThis so the interval survives dev HMR, same exact pattern
// as server-run-registry.ts's registry caching — a fresh module reload
// would otherwise register a second interval alongside the orphaned first
// one instead of replacing it.
const globalForRetryWorker = globalThis as unknown as {
	feedbackRetryWorkerStarted: boolean | undefined;
};

async function retryPendingReports(): Promise<void> {
	const pendingReports = await db.query.feedbackReports.findMany({
		where: eq(feedbackReports.status, "pending"),
		orderBy: asc(feedbackReports.createdAt),
		limit: MAX_ROWS_PER_TICK,
	});

	// Sequential, not Promise.all — per the plan's explicit reasoning: avoid
	// bursting GitHub's rate limit on a cold start with several queued rows.
	for (const report of pendingReports) {
		await attemptSendReport(db, report.id, env.GITHUB_FEEDBACK_TOKEN);
	}
}

export function startFeedbackRetryWorker(): void {
	if (globalForRetryWorker.feedbackRetryWorkerStarted) {
		return;
	}
	globalForRetryWorker.feedbackRetryWorkerStarted = true;

	setInterval(() => {
		void retryPendingReports();
	}, RETRY_INTERVAL_MS);
}
