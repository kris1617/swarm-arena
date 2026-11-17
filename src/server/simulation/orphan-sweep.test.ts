import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";

import { db } from "~/server/db";
import { simulationRuns, users } from "~/server/db/schema";

// Mocks only `isServerRunActive` — the DB query that selects stale `running`
// rows stays real, so the staleness filter is actually exercised, same
// mocking shape `retry-worker.test.ts` uses for `attemptSendReport`.
vi.mock("~/server/simulation/server-run-registry", async (importOriginal) => {
	const actual =
		await importOriginal<
			typeof import("~/server/simulation/server-run-registry")
		>();
	return {
		...actual,
		isServerRunActive: vi.fn(),
	};
});

import { startOrphanSweep } from "~/server/simulation/orphan-sweep";
import { isServerRunActive } from "~/server/simulation/server-run-registry";

const mockedIsServerRunActive = vi.mocked(isServerRunActive);

// The module's globalThis-cached idempotency flag — not exported (it's an
// internal implementation detail, same as retry-worker.ts's own flag), so
// tests poke it directly to get a fresh sweep per test instead of inheriting
// an earlier test's already-started interval.
type GlobalWithOrphanSweep = typeof globalThis & {
	orphanSweepStarted: boolean | undefined;
};

function resetSweepStartedFlag() {
	(globalThis as GlobalWithOrphanSweep).orphanSweepStarted = undefined;
}

const NOW = new Date("2024-01-01T00:00:00.000Z").getTime();
const GRACE_MS = 2 * 60 * 1000;

const trackedOwnerIds: string[] = [];

async function insertOwnerUser() {
	const [owner] = await db
		.insert(users)
		.values({ email: `orphan-sweep-owner-${crypto.randomUUID()}@example.com` })
		.returning({ id: users.id });
	if (!owner) throw new Error("failed to insert fixture owner");
	trackedOwnerIds.push(owner.id);
	return owner.id;
}

async function insertRunningRow(
	ownerId: string,
	opts: { startedAt: Date; maxDurationSeconds: number },
) {
	const [run] = await db
		.insert(simulationRuns)
		.values({
			userId: ownerId,
			seed: 1,
			boidCount: 10,
			separationWeight: 1,
			alignmentWeight: 1,
			cohesionWeight: 1,
			maxDurationSeconds: opts.maxDurationSeconds,
			predatorCount: 2,
			protectionThreshold: 3,
			foodStockInitial: 100,
			foodRegenRate: 1,
			status: "running",
			startedAt: opts.startedAt,
		})
		.returning({ id: simulationRuns.id });
	if (!run) throw new Error("failed to insert fixture run");
	return run.id;
}

afterEach(async () => {
	vi.useRealTimers();
	resetSweepStartedFlag();
	mockedIsServerRunActive.mockReset();
	for (const ownerId of trackedOwnerIds) {
		await db.delete(users).where(eq(users.id, ownerId));
	}
	trackedOwnerIds.length = 0;
});

describe("startOrphanSweep", () => {
	it("stops a running row past its deadline+grace and marks it wasAutoStopped", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(NOW);
		resetSweepStartedFlag();
		mockedIsServerRunActive.mockReturnValue(false);

		const ownerId = await insertOwnerUser();
		// deadline = startedAt + 60_000ms + GRACE_MS; make NOW well past it.
		const staleRunId = await insertRunningRow(ownerId, {
			startedAt: new Date(NOW - 60_000 - GRACE_MS - 10_000),
			maxDurationSeconds: 60,
		});

		startOrphanSweep();
		await vi.advanceTimersByTimeAsync(0);

		const row = await db.query.simulationRuns.findFirst({
			where: (t, { eq }) => eq(t.id, staleRunId),
		});
		expect(row?.status).toBe("stopped");
		expect(row?.wasAutoStopped).toBe(true);
		expect(row?.stoppedAt).not.toBeNull();
	});

	it("leaves a running row within its deadline+grace untouched", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(NOW);
		resetSweepStartedFlag();
		mockedIsServerRunActive.mockReturnValue(false);

		const ownerId = await insertOwnerUser();
		// deadline = startedAt + 60_000ms + GRACE_MS; make NOW well before it.
		const freshRunId = await insertRunningRow(ownerId, {
			startedAt: new Date(NOW - 10_000),
			maxDurationSeconds: 60,
		});

		startOrphanSweep();
		await vi.advanceTimersByTimeAsync(0);

		const row = await db.query.simulationRuns.findFirst({
			where: (t, { eq }) => eq(t.id, freshRunId),
		});
		expect(row?.status).toBe("running");
		expect(row?.wasAutoStopped).toBe(false);
	});

	// plan-review F1: a row past its deadline+grace but still tracked as
	// active by this process's own registry (e.g. a legitimately-slow
	// finalization on a large population) must never be swept.
	it("does not stop a stale row that isServerRunActive still reports as active", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(NOW);
		resetSweepStartedFlag();

		const ownerId = await insertOwnerUser();
		const activeStaleRunId = await insertRunningRow(ownerId, {
			startedAt: new Date(NOW - 60_000 - GRACE_MS - 10_000),
			maxDurationSeconds: 60,
		});
		mockedIsServerRunActive.mockImplementation(
			(runId: number) => runId === activeStaleRunId,
		);

		startOrphanSweep();
		await vi.advanceTimersByTimeAsync(0);

		const row = await db.query.simulationRuns.findFirst({
			where: (t, { eq }) => eq(t.id, activeStaleRunId),
		});
		expect(row?.status).toBe("running");
		expect(row?.wasAutoStopped).toBe(false);
	});

	it("calling startOrphanSweep twice does not register a second interval", () => {
		resetSweepStartedFlag();
		mockedIsServerRunActive.mockReturnValue(false);
		const setIntervalSpy = vi.spyOn(global, "setInterval");

		startOrphanSweep();
		startOrphanSweep();

		expect(setIntervalSpy).toHaveBeenCalledTimes(1);

		setIntervalSpy.mockRestore();
	});
});
