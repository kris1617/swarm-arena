import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GET } from "~/app/api/runs/[runId]/export/route";
import { auth } from "~/server/auth";
import { db } from "~/server/db";
import { simulationRuns, users } from "~/server/db/schema";

vi.mock("~/server/auth", () => ({
	auth: vi.fn(),
}));

const VALID_RUN_INPUT = {
	seed: 1,
	boidCount: 10,
	separationWeight: 1,
	alignmentWeight: 1,
	cohesionWeight: 1,
	maxDurationSeconds: 60,
	predatorCount: 2,
	protectionThreshold: 3,
	foodStockInitial: 100,
	foodRegenRate: 1,
	flockCount: 2,
	crossbreedingEnabled: true,
	energyThreshold: 50,
	mutationChance: 0.1,
	mutationMagnitude: 0.2,
};

// Owner ids inserted by `insertRun()` in this test run, so `afterEach` can
// clean each one up via cascade delete — same discipline
// `simulation.test.ts` follows for its own fixtures.
const trackedOwnerIds: string[] = [];

async function insertRun(
	overrides: Partial<typeof simulationRuns.$inferInsert> = {},
) {
	const [owner] = await db
		.insert(users)
		.values({ email: `owner-${crypto.randomUUID()}@example.com` })
		.returning({ id: users.id });
	if (!owner) throw new Error("failed to insert fixture owner");
	trackedOwnerIds.push(owner.id);

	const [run] = await db
		.insert(simulationRuns)
		.values({
			userId: owner.id,
			...VALID_RUN_INPUT,
			status: "stopped",
			score: 0.5,
			history: { phaseHistory: ["establishment"], foodRatioSamples: [0.5] },
			...overrides,
		})
		.returning({ id: simulationRuns.id });
	if (!run) throw new Error("failed to insert fixture run");

	return { ownerId: owner.id, runId: run.id };
}

// `auth` is next-auth's overloaded export (session getter when called with
// no args, middleware wrapper when called with a request handler) — `vi.mocked`
// picks the middleware overload, so go through the mock instance directly.
const mockedAuth = auth as unknown as ReturnType<typeof vi.fn>;

function mockSessionFor(userId: string | null) {
	mockedAuth.mockResolvedValue(
		userId
			? {
					user: { id: userId, role: "member" as const },
					expires: new Date(Date.now() + 60_000).toISOString(),
				}
			: null,
	);
}

function requestFor(runId: string, format?: string) {
	const url = new URL(
		`http://localhost/api/runs/${runId}/export${format ? `?format=${format}` : ""}`,
	);
	return new NextRequest(url);
}

afterEach(async () => {
	for (const ownerId of trackedOwnerIds) {
		await db.delete(users).where(eq(users.id, ownerId));
	}
	trackedOwnerIds.length = 0;
	mockedAuth.mockReset();
});

describe("GET /api/runs/[runId]/export", () => {
	it("returns a JSON export for the owning user", async () => {
		const { ownerId, runId } = await insertRun();
		mockSessionFor(ownerId);

		const response = await GET(requestFor(String(runId), "json"), {
			params: Promise.resolve({ runId: String(runId) }),
		});

		expect(response.status).toBe(200);
		expect(response.headers.get("Content-Type")).toBe("application/json");
		expect(response.headers.get("Content-Disposition")).toBe(
			`attachment; filename="run-${runId}.json"`,
		);
		const body = JSON.parse(await response.text()) as Record<string, unknown>;
		expect(body.id).toBe(runId);
		expect(body.history).toMatchObject({ phaseHistory: ["establishment"] });
	});

	it("returns a CSV export for the owning user", async () => {
		const { ownerId, runId } = await insertRun();
		mockSessionFor(ownerId);

		const response = await GET(requestFor(String(runId), "csv"), {
			params: Promise.resolve({ runId: String(runId) }),
		});

		expect(response.status).toBe(200);
		expect(response.headers.get("Content-Type")).toBe("text/csv");
		expect(response.headers.get("Content-Disposition")).toBe(
			`attachment; filename="run-${runId}.csv"`,
		);
		const body = await response.text();
		expect(body).not.toContain("history");
		expect(body.trim().split("\n")).toHaveLength(2);
	});

	it("returns 403 for a non-owning user", async () => {
		const { runId } = await insertRun();
		const [otherUser] = await db
			.insert(users)
			.values({ email: `other-${crypto.randomUUID()}@example.com` })
			.returning({ id: users.id });
		if (!otherUser) throw new Error("failed to insert fixture other user");
		trackedOwnerIds.push(otherUser.id);
		mockSessionFor(otherUser.id);

		const response = await GET(requestFor(String(runId)), {
			params: Promise.resolve({ runId: String(runId) }),
		});

		expect(response.status).toBe(403);
	});

	it("returns 400 for a run that is not completed", async () => {
		const { ownerId, runId } = await insertRun({ status: "running" });
		mockSessionFor(ownerId);

		const response = await GET(requestFor(String(runId)), {
			params: Promise.resolve({ runId: String(runId) }),
		});

		expect(response.status).toBe(400);
	});

	it("returns 400 for a non-numeric runId", async () => {
		mockSessionFor("irrelevant-user-id");

		const response = await GET(requestFor("not-a-number"), {
			params: Promise.resolve({ runId: "not-a-number" }),
		});

		expect(response.status).toBe(400);
	});

	it("returns 400 for a run that does not exist", async () => {
		mockSessionFor("irrelevant-user-id");

		const response = await GET(requestFor("999999999"), {
			params: Promise.resolve({ runId: "999999999" }),
		});

		expect(response.status).toBe(400);
	});
});
