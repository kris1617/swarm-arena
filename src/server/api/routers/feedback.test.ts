import type { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createCaller } from "~/server/api/root";
import { db } from "~/server/db";
import { feedbackReports, users } from "~/server/db/schema";

// Keeps the real pure helpers (mapCategoryToGithubLabel, formatIssueTitle,
// GithubApiError) — only `createGithubIssue` itself is swapped for a mock,
// so these tests never make a real network call, same pattern
// export.test.ts uses for mocking `~/server/auth`.
vi.mock("~/server/feedback/github-client", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("~/server/feedback/github-client")>();
	return {
		...actual,
		createGithubIssue: vi.fn(),
	};
});

import {
	createGithubIssue,
	GithubApiError,
} from "~/server/feedback/github-client";

const mockedCreateGithubIssue = vi.mocked(createGithubIssue);

// Owner ids inserted by `insertOwnerUser()` in this test run, so `afterEach`
// can clean each one up — deleting `users` cascade-deletes the matching
// `feedback_report` rows (`feedbackReports.userId`'s `onDelete: "cascade"`
// reference), same discipline simulation.test.ts/export.test.ts follow.
const trackedOwnerIds: string[] = [];

async function insertOwnerUser() {
	const [owner] = await db
		.insert(users)
		.values({ email: `owner-${crypto.randomUUID()}@example.com` })
		.returning({ id: users.id });
	if (!owner) throw new Error("failed to insert fixture owner");
	trackedOwnerIds.push(owner.id);
	return owner.id;
}

function sessionFor(userId: string) {
	return {
		user: { id: userId, role: "member" as const, elevatedUntil: null },
		expires: new Date(Date.now() + 60_000).toISOString(),
	};
}

function callerFor(userId: string) {
	return createCaller({
		db,
		headers: new Headers(),
		allowSelfElevation: false,
		session: sessionFor(userId),
	});
}

const VALID_INPUT = {
	category: "bug" as const,
	title: "Simulation freezes on save",
	description: "Clicking Save & Pause hangs the UI indefinitely.",
	pagePath: "/simulation",
	userAgent: "Mozilla/5.0 (test)",
};

afterEach(async () => {
	mockedCreateGithubIssue.mockReset();
	for (const ownerId of trackedOwnerIds) {
		await db.delete(users).where(eq(users.id, ownerId));
	}
	trackedOwnerIds.length = 0;
});

describe("feedbackRouter.create — rate limit", () => {
	it("rejects the 6th submission within an hour with TOO_MANY_REQUESTS", async () => {
		const ownerId = await insertOwnerUser();
		mockedCreateGithubIssue.mockResolvedValue({
			issueNumber: 1,
			issueUrl: "https://github.com/kris1617/swarm-arena/issues/1",
		});

		for (let i = 0; i < 5; i++) {
			await db.insert(feedbackReports).values({
				userId: ownerId,
				category: "bug",
				title: `Report ${i}`,
				description: "Some description",
				pagePath: "/simulation",
				userAgent: "Mozilla/5.0 (test)",
			});
		}

		await expect(
			callerFor(ownerId).feedback.create(VALID_INPUT),
		).rejects.toMatchObject({
			code: "TOO_MANY_REQUESTS",
		} satisfies Partial<TRPCError>);
	});
});

describe("feedbackRouter.create — immediate send", () => {
	it("returns status: sent with the issue URL when GitHub accepts the issue", async () => {
		const ownerId = await insertOwnerUser();
		mockedCreateGithubIssue.mockResolvedValue({
			issueNumber: 42,
			issueUrl: "https://github.com/kris1617/swarm-arena/issues/42",
		});

		const result = await callerFor(ownerId).feedback.create(VALID_INPUT);

		expect(result).toEqual({
			status: "sent",
			issueUrl: "https://github.com/kris1617/swarm-arena/issues/42",
		});

		const stored = await db.query.feedbackReports.findFirst({
			where: (t, { eq: eqFn }) => eqFn(t.userId, ownerId),
		});
		expect(stored).toMatchObject({
			status: "sent",
			githubIssueNumber: 42,
			githubIssueUrl: "https://github.com/kris1617/swarm-arena/issues/42",
		});
	});
});

describe("feedbackRouter.create — degrade to queued", () => {
	it("returns status: queued and leaves the row pending when GitHub is unreachable", async () => {
		const ownerId = await insertOwnerUser();
		mockedCreateGithubIssue.mockRejectedValue(
			new GithubApiError(401, "Bad credentials"),
		);

		const result = await callerFor(ownerId).feedback.create(VALID_INPUT);

		expect(result).toEqual({ status: "queued" });

		const stored = await db.query.feedbackReports.findFirst({
			where: (t, { eq: eqFn }) => eqFn(t.userId, ownerId),
		});
		expect(stored).toMatchObject({
			status: "pending",
			attemptCount: 1,
			lastError: "Bad credentials",
		});
	});
});
