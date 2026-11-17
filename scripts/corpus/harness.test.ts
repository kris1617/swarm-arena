import { afterEach, describe, expect, it, vi } from "vitest";

import { db } from "~/server/db";
import { resetAdminSettingsToDefaults } from "~/server/db/admin-settings-test-reset";
import { simulationRuns, users } from "~/server/db/schema";
import { DEFAULT_PARAMETER_RANGES } from "~/server/simulation/parameter-ranges";
import { stopServerRun } from "~/server/simulation/server-run-registry";
import {
	collectAndCleanupCorpusRun,
	ensureAdminRangesAdmit,
	ensureAdminRangesAdmitForBatch,
	type StartCorpusRunParams,
	startCorpusRun,
	withAdminRangesLock,
} from "./harness";

// per-tribe-behavior-weights Phase 1: type-only field this phase — not yet
// read by any engine code, so a single shared default matching today's
// pre-change global constants/weights is sufficient for every fixture here.
const DEFAULT_TRIBE_CONFIG = {
	separation: 1,
	alignment: 1,
	cohesion: 1,
	maxSpeed: 40,
	minSpeed: 15,
	matePreference: 0.5,
	neighborRadius: 70,
	separationRadius: 25,
	predatorDetectionRadius: 50,
	burstMult: 1,
	burstCostMult: 1,
};

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
	tribeConfigs: [DEFAULT_TRIBE_CONFIG, DEFAULT_TRIBE_CONFIG],
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
	// widens ranges can't leak state into a later test. Upserts back to
	// defaults instead of deleting so a concurrently-running test file never
	// observes the row as briefly absent (see admin-settings-test-reset.ts).
	await resetAdminSettingsToDefaults(db);
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

describe("ensureAdminRangesAdmitForBatch", () => {
	it("widens to the union across several param sets and returns the pre-widen snapshot", async () => {
		const original = await ensureAdminRangesAdmitForBatch(db, [
			// Default ceiling is 600 — this alone needs widening.
			{ maxDurationSeconds: 1000 },
			// A second entry needing a *wider* ceiling than the first — the
			// union must reflect this one, not the first entry's value.
			{ maxDurationSeconds: 3600 },
			// A field only this third entry touches, already in range (10
			// is within the default 1-500 boidCount range) — must stay
			// untouched.
			{ boidCount: 10 },
		]);

		expect(original).toEqual(DEFAULT_PARAMETER_RANGES);

		const widened = await readAdminRanges();

		expect(widened.maxDurationSeconds).toEqual({
			min: DEFAULT_PARAMETER_RANGES.maxDurationSeconds.min,
			max: 3600,
			default: DEFAULT_PARAMETER_RANGES.maxDurationSeconds.default,
		});
		expect(widened.boidCount).toEqual(DEFAULT_PARAMETER_RANGES.boidCount);
	});

	it("writes the union exactly once (not once per entry)", async () => {
		const updateSpy = vi.spyOn(db, "update");

		await ensureAdminRangesAdmitForBatch(db, [
			{ maxDurationSeconds: 1000 },
			{ maxDurationSeconds: 3600 },
			{ maxDurationSeconds: 5000 },
		]);

		expect(updateSpy).toHaveBeenCalledTimes(1);

		const widened = await readAdminRanges();
		expect(widened.maxDurationSeconds.max).toBe(5000);

		updateSpy.mockRestore();
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

		// collectAndCleanupCorpusRun cleans up the fixture owner even on
		// this throw path (finally-based cleanup) — no manual delete needed.
		const ownerRow = await db.query.users.findFirst({
			where: (t, { eq: eqFn }) => eqFn(t.id, owner.id),
		});
		expect(ownerRow).toBeUndefined();
	});
});

describe("startCorpusRun batch mode (skipRangeWiden)", () => {
	// Reproduces the race described in the plan's Current State Analysis:
	// two concurrent `startCorpusRun` calls that each individually need a
	// wider admin range than the default would otherwise each widen then
	// restore on their own, racing each other's restore against the other
	// call's still-in-progress `startServer`. Pre-widening once via
	// `ensureAdminRangesAdmitForBatch` and having both calls opt out of
	// their own widen/restore (`skipRangeWiden: true`) must let both
	// succeed with neither spuriously rejected by the admin-range gate.
	it("lets two concurrent batch-mode calls both succeed when both need a wider range than default", async () => {
		vi.useFakeTimers();

		const paramsA: StartCorpusRunParams = {
			...VALID_START_INPUT,
			// Default ceiling is 600 — both values exceed it, so neither call
			// would pass `checkAgainstAdminRanges` without the batch widen.
			maxDurationSeconds: 1000,
		};
		const paramsB: StartCorpusRunParams = {
			...VALID_START_INPUT,
			maxDurationSeconds: 3600,
		};

		await ensureAdminRangesAdmitForBatch(db, [paramsA, paramsB]);

		const [resultA, resultB] = await Promise.all([
			pump(startCorpusRun(db, paramsA, { skipRangeWiden: true })),
			pump(startCorpusRun(db, paramsB, { skipRangeWiden: true })),
		]);

		expect(resultA.runId).toBeTypeOf("number");
		expect(resultB.runId).toBeTypeOf("number");
		expect(resultA.ownerId).not.toBe(resultB.ownerId);

		// Neither call restored the shared row on its own — it's still the
		// batch-widened union, wide enough for both.
		const rangesDuring = await readAdminRanges();
		expect(rangesDuring.maxDurationSeconds.max).toBe(3600);

		// Clean up both fixture runs/owners the same way other tests in this
		// file do: stop, then collect+cleanup.
		await pump(stopServerRun(resultA.runId));
		await pump(stopServerRun(resultB.runId));
		await pump(collectAndCleanupCorpusRun(db, resultA.ownerId, resultA.runId));
		await pump(collectAndCleanupCorpusRun(db, resultB.ownerId, resultB.runId));
	});
});

describe("startCorpusRun standalone mode (own widen/restore, concurrent)", () => {
	// Unlike the batch-mode test above (both calls pass `skipRangeWiden: true`
	// and share a single pre-widen done before `Promise.all` even starts),
	// this exercises the actual path Phase 4's `withAdminRangesLock` protects:
	// two concurrent STANDALONE `startCorpusRun` calls, each doing its own
	// internal widen (`ensureAdminRangesAdmit`) and its own restore in
	// `finally`. Without the lock, one call's restore-to-its-own-snapshot can
	// clobber the other call's still-in-progress widen, corrupting the shared
	// `admin_settings.parameterRanges` row.
	it("lets two concurrent standalone startCorpusRun calls both succeed and restores the true original range afterward", async () => {
		vi.useFakeTimers();

		const paramsA: StartCorpusRunParams = {
			...VALID_START_INPUT,
			// Default ceiling is 600 — both values exceed it, so each call's own
			// widen must independently admit it.
			maxDurationSeconds: 1000,
		};
		const paramsB: StartCorpusRunParams = {
			...VALID_START_INPUT,
			maxDurationSeconds: 3600,
		};

		const [resultA, resultB] = await Promise.all([
			pump(startCorpusRun(db, paramsA)),
			pump(startCorpusRun(db, paramsB)),
		]);

		// impl-review F1: wrapped in try/finally so an assertion failure
		// below can't skip cleanup and leak both fixture rows into later
		// tests in this worker.
		try {
			expect(resultA.runId).toBeTypeOf("number");
			expect(resultB.runId).toBeTypeOf("number");
			expect(resultA.ownerId).not.toBe(resultB.ownerId);

			// Both calls' own restores must have serialized correctly (via the
			// lock) and landed back on the true original default — not the
			// widened value either call left behind, and not some
			// partially-restored/corrupted hybrid.
			const rangesAfter = await readAdminRanges();
			expect(rangesAfter.maxDurationSeconds).toEqual(
				DEFAULT_PARAMETER_RANGES.maxDurationSeconds,
			);
		} finally {
			// Clean up both fixture runs/owners the same way other tests in
			// this file do: stop, then collect+cleanup.
			await pump(stopServerRun(resultA.runId));
			await pump(stopServerRun(resultB.runId));
			await pump(
				collectAndCleanupCorpusRun(db, resultA.ownerId, resultA.runId),
			);
			await pump(
				collectAndCleanupCorpusRun(db, resultB.ownerId, resultB.runId),
			);
		}
	});
});

describe("withAdminRangesLock", () => {
	// The end-to-end concurrent-startCorpusRun test above exercises the real
	// call path, but natural Promise.all scheduling doesn't reliably force
	// the exact interleaving the lock protects against (confirmed: 18/18
	// clean even with the lock temporarily removed during this phase's own
	// deliberate-break check). This test instead proves the lock's own
	// serialization property directly and deterministically: two concurrent
	// callers must never have their critical sections overlap, regardless of
	// scheduling.
	it("never lets two concurrent critical sections overlap", async () => {
		const events: string[] = [];
		let releaseFirst: (() => void) | undefined;

		const first = withAdminRangesLock(async () => {
			events.push("first-enter");
			await new Promise<void>((resolve) => {
				releaseFirst = resolve;
			});
			events.push("first-exit");
		});

		// Give `first` a tick to actually enter its critical section before
		// starting `second`, so `second` is guaranteed to be the one waiting.
		await Promise.resolve();

		const second = withAdminRangesLock(async () => {
			events.push("second-enter");
			events.push("second-exit");
		});

		// `second` must not have entered yet — `first` is still holding the
		// lock (blocked on its own un-resolved promise).
		expect(events).toEqual(["first-enter"]);

		releaseFirst?.();
		await Promise.all([first, second]);

		expect(events).toEqual([
			"first-enter",
			"first-exit",
			"second-enter",
			"second-exit",
		]);
	});
});
