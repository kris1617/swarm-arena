import type { TRPCError } from "@trpc/server";
import { describe, expect, it } from "vitest";

import { createCaller } from "~/server/api/root";
import { db } from "~/server/db";

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
});
