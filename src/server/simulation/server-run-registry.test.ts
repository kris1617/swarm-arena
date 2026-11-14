import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";

import { db } from "~/server/db";
import { simulationRuns, users } from "~/server/db/schema";
import {
	getLiveRunState,
	type ServerRunParams,
	startServerRun,
	stopServerRun,
} from "~/server/simulation/server-run-registry";
import * as singleRunLifecycle from "~/server/simulation/single-run-lifecycle";

const BASE_PARAMS: Omit<ServerRunParams, "runId" | "seed"> = {
	boidCount: 10,
	separationWeight: 1,
	alignmentWeight: 1,
	cohesionWeight: 1,
	maxDurationSeconds: 1,
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

// Owner ids inserted by `insertOwnedRunningRun()` in this test run, so
// `afterEach` can clean each one up via cascade delete — same pattern as
// `src/server/api/routers/simulation.test.ts`.
const trackedOwnerIds: string[] = [];
const activeRunIds: number[] = [];

async function insertOwnedRunningRun(seed: number) {
	const [owner] = await db
		.insert(users)
		.values({ email: `registry-owner-${crypto.randomUUID()}@example.com` })
		.returning({ id: users.id });
	if (!owner) {
		throw new Error("failed to insert fixture owner");
	}
	trackedOwnerIds.push(owner.id);

	const [run] = await db
		.insert(simulationRuns)
		.values({
			userId: owner.id,
			seed,
			boidCount: BASE_PARAMS.boidCount,
			separationWeight: BASE_PARAMS.separationWeight,
			alignmentWeight: BASE_PARAMS.alignmentWeight,
			cohesionWeight: BASE_PARAMS.cohesionWeight,
			maxDurationSeconds: BASE_PARAMS.maxDurationSeconds,
			predatorCount: BASE_PARAMS.predatorCount,
			protectionThreshold: BASE_PARAMS.protectionThreshold,
			foodStockInitial: BASE_PARAMS.foodStockInitial,
			foodRegenRate: BASE_PARAMS.foodRegenRate,
			flockCount: BASE_PARAMS.flockCount,
			crossbreedingEnabled: BASE_PARAMS.crossbreedingEnabled,
			energyThreshold: BASE_PARAMS.energyThreshold,
			mutationChance: BASE_PARAMS.mutationChance,
			mutationMagnitude: BASE_PARAMS.mutationMagnitude,
			status: "running",
		})
		.returning({ id: simulationRuns.id });
	if (!run) {
		throw new Error("failed to insert fixture run");
	}
	return run.id;
}

afterEach(async () => {
	vi.useRealTimers();
	// Belt-and-suspenders: stop any run a failed assertion left ticking so it
	// can't leak a live interval into a later test file in this worker.
	for (const runId of activeRunIds) {
		await stopServerRun(runId);
	}
	activeRunIds.length = 0;

	for (const ownerId of trackedOwnerIds) {
		await db.delete(users).where(eq(users.id, ownerId));
	}
	trackedOwnerIds.length = 0;
});

describe("server-run-registry", () => {
	it("ticks a run to natural completion and writes a scored, stopped row with no client involved", async () => {
		vi.useFakeTimers();
		const runId = await insertOwnedRunningRun(1);
		activeRunIds.push(runId);

		startServerRun({ runId, seed: 1, ...BASE_PARAMS });
		expect(getLiveRunState(runId)).toBeDefined();

		// maxDurationSeconds: 1 at ~16ms/tick needs ~63 ticks to cross; advance
		// generously past that, then flush once more so the final tick's
		// fire-and-forget DB write (triggered from inside the interval
		// callback, not awaited by the test) has a chance to settle.
		await vi.advanceTimersByTimeAsync(3000);
		await vi.advanceTimersByTimeAsync(0);

		expect(getLiveRunState(runId)).toBeUndefined();
		const row = await db.query.simulationRuns.findFirst({
			where: (t, { eq }) => eq(t.id, runId),
		});
		expect(row?.status).toBe("stopped");
		expect(row?.score).not.toBeNull();
		activeRunIds.length = 0; // already finished; nothing left for afterEach to stop
	});

	it("stopServerRun ends the run early with a score from the partial cohesion history", async () => {
		vi.useFakeTimers();
		const runId = await insertOwnedRunningRun(2);
		activeRunIds.push(runId);

		startServerRun({
			runId,
			seed: 2,
			...BASE_PARAMS,
			maxDurationSeconds: 600,
		});
		await vi.advanceTimersByTimeAsync(160); // a handful of ticks, nowhere near completion

		await stopServerRun(runId);

		expect(getLiveRunState(runId)).toBeUndefined();
		const row = await db.query.simulationRuns.findFirst({
			where: (t, { eq }) => eq(t.id, runId),
		});
		expect(row?.status).toBe("stopped");
		expect(row?.score).not.toBeNull();
		activeRunIds.length = 0;
	});

	it("stopServerRun on an unregistered runId is a no-op", async () => {
		await expect(stopServerRun(999_999)).resolves.toBeUndefined();
	});

	it("getLiveRunState returns undefined once a run has stopped", async () => {
		vi.useFakeTimers();
		const runId = await insertOwnedRunningRun(3);
		activeRunIds.push(runId);

		startServerRun({ runId, seed: 3, ...BASE_PARAMS });
		expect(getLiveRunState(runId)).toBeDefined();

		await stopServerRun(runId);
		expect(getLiveRunState(runId)).toBeUndefined();
		activeRunIds.length = 0;
	});

	it("a tick that throws stops the run and leaves score null, without crashing", async () => {
		vi.useFakeTimers();
		const runId = await insertOwnedRunningRun(5);
		activeRunIds.push(runId);
		const consoleErrorSpy = vi
			.spyOn(console, "error")
			.mockImplementation(() => undefined);
		const tickSpy = vi
			.spyOn(singleRunLifecycle, "computeSingleRunTick")
			.mockImplementationOnce(() => {
				throw new Error("boom");
			});

		startServerRun({ runId, seed: 5, ...BASE_PARAMS, maxDurationSeconds: 600 });
		await vi.advanceTimersByTimeAsync(32);
		await vi.advanceTimersByTimeAsync(0);

		expect(getLiveRunState(runId)).toBeUndefined();
		const row = await db.query.simulationRuns.findFirst({
			where: (t, { eq }) => eq(t.id, runId),
		});
		expect(row?.status).toBe("stopped");
		expect(row?.score).toBeNull();
		expect(consoleErrorSpy).toHaveBeenCalled();

		tickSpy.mockRestore();
		consoleErrorSpy.mockRestore();
		activeRunIds.length = 0;
	});

	it("stops the run on a population wipe (zero boids) without crashing", async () => {
		vi.useFakeTimers();
		const runId = await insertOwnedRunningRun(4);
		activeRunIds.push(runId);

		// boidCount: 0 + predatorCount: 0 means the first tick's `nextBoids`
		// is already empty, so `computeSingleRunTick`'s own
		// `nextBoids.length === 0` rule should fire shouldStop immediately.
		startServerRun({
			runId,
			seed: 4,
			...BASE_PARAMS,
			boidCount: 0,
			predatorCount: 0,
			maxDurationSeconds: 600,
		});

		await vi.advanceTimersByTimeAsync(100);
		await vi.advanceTimersByTimeAsync(0);

		expect(getLiveRunState(runId)).toBeUndefined();
		const row = await db.query.simulationRuns.findFirst({
			where: (t, { eq }) => eq(t.id, runId),
		});
		expect(row?.status).toBe("stopped");
		activeRunIds.length = 0;
	});
});
