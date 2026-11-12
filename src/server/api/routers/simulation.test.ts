import type { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { createCaller } from "~/server/api/root";
import { db } from "~/server/db";
import { simulationRuns, users } from "~/server/db/schema";

const VALID_START_INPUT = {
	boidCount: 10,
	separationWeight: 1,
	alignmentWeight: 1,
	cohesionWeight: 1,
	maxDurationSeconds: 60,
	predatorCount: 2,
	protectionThreshold: 3,
	foodStockInitial: 100,
	foodRegenRate: 1,
};

// A minimal but type-correct session (see the `declare module "next-auth"`
// augmentation in ~/server/auth/config.ts) — just enough for
// `protectedProcedure`'s middleware to pass, so the FR-018 combined-cap
// `.refine()` on `start`'s input schema is reachable without touching the
// database (invalid input is rejected before the resolver body runs).
const SESSION = {
	user: { id: "test-user-id", role: "member" as const },
	expires: new Date(Date.now() + 60_000).toISOString(),
};

// Owner ids from fixtures inserted by `insertOwnedRunningRun()` in this test
// run, so `afterEach` can clean each one up via cascade delete.
const trackedOwnerIds: string[] = [];

// `@libsql/client` enforces foreign keys by default, so `simulation.stop`'s
// ownership check (which reads an existing `simulationRuns` row) needs a
// real `users` row and a real `simulationRuns` row pointing at it — a
// fabricated session alone isn't enough for this resolver, unlike `start`'s
// UNAUTHORIZED case below which never reads the DB.
async function insertOwnedRunningRun() {
	const [owner] = await db
		.insert(users)
		.values({
			email: `owner-${crypto.randomUUID()}@example.com`,
		})
		.returning({ id: users.id });

	if (!owner) {
		throw new Error("failed to insert fixture owner");
	}

	trackedOwnerIds.push(owner.id);

	const [run] = await db
		.insert(simulationRuns)
		.values({
			userId: owner.id,
			seed: 1,
			boidCount: VALID_START_INPUT.boidCount,
			separationWeight: VALID_START_INPUT.separationWeight,
			alignmentWeight: VALID_START_INPUT.alignmentWeight,
			cohesionWeight: VALID_START_INPUT.cohesionWeight,
			maxDurationSeconds: VALID_START_INPUT.maxDurationSeconds,
			predatorCount: VALID_START_INPUT.predatorCount,
			protectionThreshold: VALID_START_INPUT.protectionThreshold,
			foodStockInitial: VALID_START_INPUT.foodStockInitial,
			foodRegenRate: VALID_START_INPUT.foodRegenRate,
			status: "running",
		})
		.returning({ id: simulationRuns.id });

	if (!run) {
		throw new Error("failed to insert fixture run");
	}

	return { ownerId: owner.id, runId: run.id };
}

afterEach(async () => {
	// Deleting the `users` row cascade-deletes the matching `simulationRuns`
	// row (see `simulationRuns.userId`'s `onDelete: "cascade"` reference).
	for (const ownerId of trackedOwnerIds) {
		await db.delete(users).where(eq(users.id, ownerId));
	}
	trackedOwnerIds.length = 0;
});

describe("simulationRouter.start", () => {
	it("rejects when boidCount + predatorCount exceeds the combined FR-018 cap of 500", async () => {
		const caller = createCaller({
			db,
			headers: new Headers(),
			session: SESSION,
		});

		// Asserts specifically on a BAD_REQUEST (input-validation) rejection,
		// not just "something threw" — a downstream DB error (e.g. a missing
		// FK for this fabricated session's userId) also throws and would make
		// a bare `.rejects.toThrow()` pass vacuously even if the combined-cap
		// `.refine()` were removed entirely.
		await expect(
			caller.simulation.start({
				...VALID_START_INPUT,
				boidCount: 400,
				predatorCount: 200,
			}),
		).rejects.toMatchObject({
			code: "BAD_REQUEST",
		} satisfies Partial<TRPCError>);
	});

	it("rejects with UNAUTHORIZED when there is no session", async () => {
		const caller = createCaller({
			db,
			headers: new Headers(),
			session: null,
		});

		await expect(
			caller.simulation.start(VALID_START_INPUT),
		).rejects.toMatchObject({
			code: "UNAUTHORIZED",
		} satisfies Partial<TRPCError>);
	});
});

describe("simulationRouter.stop authorization", () => {
	it("rejects with FORBIDDEN when the caller does not own the run", async () => {
		const { runId } = await insertOwnedRunningRun();

		// No real `users` row is needed for this caller — `stop`'s resolver
		// never writes anything keyed to it, so a fabricated session with a
		// different id is enough to exercise the ownership check.
		const caller = createCaller({
			db,
			headers: new Headers(),
			session: {
				user: { id: "attacker-user-id", role: "member" as const },
				expires: new Date(Date.now() + 60_000).toISOString(),
			},
		});

		await expect(
			caller.simulation.stop({
				runId,
				elapsedTicks: 1,
				cohesionSamples: [0.5],
			}),
		).rejects.toMatchObject({
			code: "FORBIDDEN",
		} satisfies Partial<TRPCError>);
	});

	it("allows the owner's own call to succeed (contrast case)", async () => {
		const { ownerId, runId } = await insertOwnedRunningRun();

		const caller = createCaller({
			db,
			headers: new Headers(),
			session: {
				user: { id: ownerId, role: "member" as const },
				expires: new Date(Date.now() + 60_000).toISOString(),
			},
		});

		const result = await caller.simulation.stop({
			runId,
			elapsedTicks: 1,
			cohesionSamples: [0.5],
		});

		expect(result).toHaveProperty("score");
	});

	it("rejects with UNAUTHORIZED when there is no session", async () => {
		const caller = createCaller({
			db,
			headers: new Headers(),
			session: null,
		});

		await expect(
			caller.simulation.stop({
				runId: 1,
				elapsedTicks: 1,
				cohesionSamples: [0.5],
			}),
		).rejects.toMatchObject({
			code: "UNAUTHORIZED",
		} satisfies Partial<TRPCError>);
	});
});
