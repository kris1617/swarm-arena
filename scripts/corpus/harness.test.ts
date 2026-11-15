import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";

import { db } from "~/server/db";
import { adminSettings, simulationRuns, users } from "~/server/db/schema";
import { DEFAULT_PARAMETER_RANGES } from "~/server/simulation/parameter-ranges";
import { stopServerRun } from "~/server/simulation/server-run-registry";
import {
	collectAndCleanupCorpusRun,
	ensureAdminRangesAdmit,
	type StartCorpusRunParams,
	startCorpusRun,
} from "./harness";

const VALID_START_INPUT: StartCorpusRunParams = {
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
	xyArea: 200,
	zDepth: 200,
};

async function readAdminRanges(): Promise<typeof DEFAULT_PARAMETER_RANGES> {
	const row = await db.query.adminSettings.findFirst({
		where: (t, { eq: eqFn }) => eqFn(t.id, 1),
	});
	if (!row) {
		throw new Error("readAdminRanges: adminSettings row is missing");
	}
	return row.parameterRanges as typeof DEFAULT_PARAMETER_RANGES;
}

// `startCorpusRun`/`collectAndCleanupCorpusRun` go through the real
// `createCaller`-based tRPC path, whose `timingMiddleware`
// (src/server/api/trpc.ts) awaits a real `setTimeout` artificial delay
// whenever `NODE_ENV !== "production"` — true for every Vitest run. Under
// `vi.useFakeTimers()` that delay's `setTimeout` never fires on its own, so
// a plain `await` on a tRPC call deadlocks forever. Racing small, repeated
// `advanceTimersByTimeAsync` ticks against the target promise flushes
// whatever timers it's waiting on without needing to know their exact delay
// up front — the same "pump the fake clock until done" idiom used wherever
// fake timers and real async I/O must coexist.
async function pump<T>(promise: Promise<T>): Promise<T> {
	let settled = false;
	promise.then(
		() => {
			settled = true;
		},
		() => {
			settled = true;
		},
	);
	while (!settled) {
		await vi.advanceTimersByTimeAsync(50);
	}
	return promise;
}

afterEach(async () => {
	vi.useRealTimers();
	// Same reset discipline as simulation.test.ts's afterEach — a test that
	// widens ranges can't leak state into a later test; getOrSeedAdminSettings
	// (and this module's own duplicate) reseeds the default row on next read.
	await db.delete(adminSettings);
});

describe("ensureAdminRangesAdmit", () => {
	it("widens only the fields actually out of range and leaves in-range fields untouched, returning the pre-call snapshot", async () => {
		const original = await ensureAdminRangesAdmit(db, {
			// Default ceiling is 600 — this is out of range and must widen.
			maxDurationSeconds: 3600,
			// Default range is 1-500 — 10 is already in range and must not
			// change.
			boidCount: 10,
		});

		expect(original).toEqual(DEFAULT_PARAMETER_RANGES);

		const widened = await readAdminRanges();

		expect(widened.maxDurationSeconds).toEqual({
			min: DEFAULT_PARAMETER_RANGES.maxDurationSeconds.min,
			max: 3600,
			default: DEFAULT_PARAMETER_RANGES.maxDurationSeconds.default,
		});
		expect(widened.boidCount).toEqual(DEFAULT_PARAMETER_RANGES.boidCount);
	});

	it("floors min down when the value is below the current minimum", async () => {
		await ensureAdminRangesAdmit(db, { maxDurationSeconds: 0 });

		const widened = await readAdminRanges();

		expect(widened.maxDurationSeconds.min).toBe(0);
		expect(widened.maxDurationSeconds.max).toBe(
			DEFAULT_PARAMETER_RANGES.maxDurationSeconds.max,
		);
	});
});

describe("startCorpusRun / collectAndCleanupCorpusRun round trip", () => {
	it("completes a full start -> advance -> collect -> cleanup round trip, restoring admin ranges and leaving no fixture rows behind", async () => {
		vi.useFakeTimers();

		// A short, in-range duration (no widening needed) — ticking all the way
		// to natural completion stays fast. See the "widens maxDurationSeconds
		// to 3600 and lets the real startServer gate admit it" test below for
		// the admin-range-widening path exercised against a genuinely
		// out-of-range value; this test's job is the full round-trip shape.
		const { runId, ownerId } = await pump(
			startCorpusRun(db, { ...VALID_START_INPUT, maxDurationSeconds: 1 }),
		);

		// The admin range widen-then-restore around `startServer` must already
		// be back to the pre-call default by the time this resolves, well
		// before fake time is advanced at all.
		const rangesRightAfterStart = await readAdminRanges();
		expect(rangesRightAfterStart.maxDurationSeconds).toEqual(
			DEFAULT_PARAMETER_RANGES.maxDurationSeconds,
		);

		// Advance past the simulated 1s duration, then flush once more so the
		// final tick's fire-and-forget DB write settles — same two-call pattern
		// server-run-registry.test.ts already establishes.
		await vi.advanceTimersByTimeAsync(3000);
		await vi.advanceTimersByTimeAsync(0);

		const record = await pump(collectAndCleanupCorpusRun(db, ownerId, runId));

		expect(record.score).not.toBeNull();
		expect(record.history).toMatchObject({
			phaseHistory: expect.any(Array),
			foodRatioSamples: expect.any(Array),
			survivorGenes: expect.any(Array),
		});
		expect(record.finalGeneticDiversity).toBeTypeOf("number");

		// Fixture owner and run no longer exist (cascade-deleted).
		const ownerRow = await db.query.users.findFirst({
			where: (t, { eq: eqFn }) => eqFn(t.id, ownerId),
		});
		expect(ownerRow).toBeUndefined();
		const runRow = await db.query.simulationRuns.findFirst({
			where: (t, { eq: eqFn }) => eqFn(t.id, runId),
		});
		expect(runRow).toBeUndefined();

		// Admin ranges are back to their pre-call value — the restore actually
		// happened, not just attempted.
		const rangesAfter = await readAdminRanges();
		expect(rangesAfter.maxDurationSeconds).toEqual(
			DEFAULT_PARAMETER_RANGES.maxDurationSeconds,
		);
	});

	// S-33's own ~20-run sweep needs `maxDurationSeconds` values up to 3600 —
	// well above the default 1-600 admin range — to actually reach the real
	// server-owned `startServer` gate (`checkAgainstAdminRanges`,
	// simulation.ts:224). This test proves the *live* widen-then-restore path
	// integrates correctly with that real gate: if `ensureAdminRangesAdmit`
	// failed to widen far enough, `startServer` would reject with BAD_REQUEST
	// immediately, before any ticking even starts.
	//
	// It deliberately does NOT tick this run to natural completion (which
	// would need ~225,000 ticks at TICK_INTERVAL_MS=16ms): discovered while
	// implementing this phase, `single-run-lifecycle.ts`'s per-tick history
	// arrays are each rebuilt via `[...array, next]` (a full O(n) copy per
	// tick), making total tick cost grow faster than linearly with tick
	// count — a run of even a few thousand ticks already takes real seconds,
	// and 225,000 ticks did not finish inside a 2-minute timeout while
	// investigating this phase. That's a pre-existing characteristic of code
	// this phase doesn't touch, not a defect in this harness — flagged in
	// this phase's final report for the project to address separately.
	// `stopServerRun` (the same manual-stop path `savePause`'s sibling, and
	// existing tests, already use) ends the run immediately instead, which is
	// enough to prove collect+cleanup still works against a real `stopped`
	// row.
	it("widens maxDurationSeconds to 3600 and lets the real startServer gate admit it", async () => {
		vi.useFakeTimers();

		const { runId, ownerId } = await pump(
			startCorpusRun(db, { ...VALID_START_INPUT, maxDurationSeconds: 3600 }),
		);

		const rangesRightAfterStart = await readAdminRanges();
		expect(rangesRightAfterStart.maxDurationSeconds).toEqual(
			DEFAULT_PARAMETER_RANGES.maxDurationSeconds,
		);

		await pump(stopServerRun(runId));

		const record = await pump(collectAndCleanupCorpusRun(db, ownerId, runId));
		expect(record.score).not.toBeNull();

		const ownerRow = await db.query.users.findFirst({
			where: (t, { eq: eqFn }) => eqFn(t.id, ownerId),
		});
		expect(ownerRow).toBeUndefined();
	});

	it("throws when the run has not actually stopped yet", async () => {
		// No fake timers / ticking needed here — a "running" row is all
		// `getRunAnalysis` (and so `collectAndCleanupCorpusRun`) needs to
		// reject on, so this fixture is inserted directly, the same way
		// `simulation.test.ts`'s own `insertOwnedRunningRun` does.
		const [owner] = await db
			.insert(users)
			.values({ email: `corpus-${crypto.randomUUID()}@example.com` })
			.returning({ id: users.id });
		if (!owner) {
			throw new Error("failed to insert fixture owner");
		}
		const [run] = await db
			.insert(simulationRuns)
			.values({
				userId: owner.id,
				seed: 1,
				...VALID_START_INPUT,
				status: "running",
			})
			.returning({ id: simulationRuns.id });
		if (!run) {
			throw new Error("failed to insert fixture run");
		}

		await expect(
			collectAndCleanupCorpusRun(db, owner.id, run.id),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });

		// Manual cleanup since the run was never allowed to finish naturally.
		await db.delete(users).where(eq(users.id, owner.id));
	});
});
