import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";

import { db } from "~/server/db";
import { feedbackReports, users } from "~/server/db/schema";

// Mocks only the GitHub-calling helper — the DB query that selects pending
// rows stays real, so the "pending" filter and ordering are actually
// exercised, same mocking shape feedback.test.ts uses for createGithubIssue.
vi.mock("~/server/feedback/send-report", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("~/server/feedback/send-report")>();
	return {
		...actual,
		attemptSendReport: vi.fn(),
	};
});

import {
	RETRY_INTERVAL_MS,
	startFeedbackRetryWorker,
} from "~/server/feedback/retry-worker";
import { attemptSendReport } from "~/server/feedback/send-report";

const mockedAttemptSendReport = vi.mocked(attemptSendReport);

// The module's globalThis-cached idempotency flag — not exported (it's an
// internal implementation detail, same as server-run-registry.ts's own
// registry Map), so tests poke it directly to get a fresh worker per test
// instead of inheriting the first test's already-started interval.
type GlobalWithRetryWorker = typeof globalThis & {
	feedbackRetryWorkerStarted: boolean | undefined;
};

function resetWorkerStartedFlag() {
	(globalThis as GlobalWithRetryWorker).feedbackRetryWorkerStarted = undefined;
}

const trackedOwnerIds: string[] = [];

async function insertOwnerUser() {
	const [owner] = await db
		.insert(users)
		.values({ email: `retry-worker-owner-${crypto.randomUUID()}@example.com` })
		.returning({ id: users.id });
	if (!owner) throw new Error("failed to insert fixture owner");
	trackedOwnerIds.push(owner.id);
	return owner.id;
}

async function insertReport(
	ownerId: string,
	status: "pending" | "sent" | "abandoned",
) {
	const [report] = await db
		.insert(feedbackReports)
		.values({
			userId: ownerId,
			category: "bug",
			title: `Report (${status})`,
			description: "Some description",
			pagePath: "/simulation",
			userAgent: "Mozilla/5.0 (test)",
			status,
		})
		.returning({ id: feedbackReports.id });
	if (!report) throw new Error("failed to insert fixture report");
	return report.id;
}

afterEach(async () => {
	vi.useRealTimers();
	resetWorkerStartedFlag();
	mockedAttemptSendReport.mockReset();
	for (const ownerId of trackedOwnerIds) {
		await db.delete(users).where(eq(users.id, ownerId));
	}
	trackedOwnerIds.length = 0;
});

describe("startFeedbackRetryWorker", () => {
	it("calls attemptSendReport for a pending row after the interval fires once", async () => {
		vi.useFakeTimers();
		resetWorkerStartedFlag();
		mockedAttemptSendReport.mockResolvedValue({ sent: false });

		const ownerId = await insertOwnerUser();
		const reportId = await insertReport(ownerId, "pending");

		startFeedbackRetryWorker();
		await vi.advanceTimersByTimeAsync(RETRY_INTERVAL_MS);

		expect(mockedAttemptSendReport).toHaveBeenCalledTimes(1);
		expect(mockedAttemptSendReport).toHaveBeenCalledWith(
			db,
			reportId,
			expect.any(String),
		);
	});

	it("does not call attemptSendReport for rows already sent or abandoned", async () => {
		vi.useFakeTimers();
		resetWorkerStartedFlag();
		mockedAttemptSendReport.mockResolvedValue({ sent: false });

		const ownerId = await insertOwnerUser();
		await insertReport(ownerId, "sent");
		await insertReport(ownerId, "abandoned");

		startFeedbackRetryWorker();
		await vi.advanceTimersByTimeAsync(RETRY_INTERVAL_MS);

		expect(mockedAttemptSendReport).not.toHaveBeenCalled();
	});

	it("calling startFeedbackRetryWorker twice does not register a second interval", async () => {
		vi.useFakeTimers();
		resetWorkerStartedFlag();
		mockedAttemptSendReport.mockResolvedValue({ sent: false });

		const ownerId = await insertOwnerUser();
		const reportId = await insertReport(ownerId, "pending");

		startFeedbackRetryWorker();
		startFeedbackRetryWorker();
		await vi.advanceTimersByTimeAsync(RETRY_INTERVAL_MS);

		// If a second interval had been registered, the same pending row would
		// have been picked up by both intervals on this one tick, calling
		// attemptSendReport twice for it instead of once.
		expect(mockedAttemptSendReport).toHaveBeenCalledTimes(1);
		expect(mockedAttemptSendReport).toHaveBeenCalledWith(
			db,
			reportId,
			expect.any(String),
		);
	});

	// impl-review F2: a thrown exception from one row (e.g. a transient DB
	// error inside attemptSendReport) must not abort the rest of the tick's
	// batch, and must not escape the interval callback as an unhandled
	// rejection that could crash the whole server process.
	it("continues to the next row when attemptSendReport throws for an earlier one", async () => {
		vi.useFakeTimers();
		resetWorkerStartedFlag();
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		const ownerId = await insertOwnerUser();
		const failingReportId = await insertReport(ownerId, "pending");
		const okReportId = await insertReport(ownerId, "pending");

		mockedAttemptSendReport.mockImplementation(async (_db, reportId) => {
			if (reportId === failingReportId) {
				throw new Error("simulated transient DB error");
			}
			return { sent: false };
		});

		startFeedbackRetryWorker();
		await vi.advanceTimersByTimeAsync(RETRY_INTERVAL_MS);

		expect(mockedAttemptSendReport).toHaveBeenCalledWith(
			db,
			failingReportId,
			expect.any(String),
		);
		expect(mockedAttemptSendReport).toHaveBeenCalledWith(
			db,
			okReportId,
			expect.any(String),
		);
		expect(errorSpy).toHaveBeenCalled();

		errorSpy.mockRestore();
	});
});
