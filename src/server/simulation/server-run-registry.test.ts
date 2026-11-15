import type { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";

import { db } from "~/server/db";
import { simulationRuns, users } from "~/server/db/schema";
import type { BoidGenes, BoidState } from "~/server/simulation/boids";
import {
	applyLiveParams,
	getLiveRunState,
	type ParameterChangeEntry,
	resumeServerRun,
	type ServerRunParams,
	type ServerRunSnapshot,
	snapshotServerRun,
	startServerRun,
	stopServerRun,
	watchServerRun,
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
	xyArea: 200,
	zDepth: 200,
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
	return { ownerId: owner.id, runId: run.id };
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
		const { runId } = await insertOwnedRunningRun(1);
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
		// F-05 (MS-08): the tick-level history is persisted alongside the
		// score instead of being discarded.
		expect(row?.history).toMatchObject({
			phaseHistory: expect.any(Array),
			foodRatioSamples: expect.any(Array),
			survivorGenes: expect.any(Array),
		});
		// S-11 (MS-08): population-over-time chart's data source — checked
		// for non-empty, not just "is an array", so a write that always sends
		// `[]` (losing the actual per-tick data) is actually caught.
		expect(
			(row?.history as { populationCountSamples?: number[] } | null)
				?.populationCountSamples?.length,
		).toBeGreaterThan(0);
		// compare-runs-side-by-side Phase 1: the survival factor must be
		// persisted alongside the other history fields — the tick loop's
		// own `shouldStop` write site.
		expect(
			(row?.history as { elapsedSeconds?: number } | null)?.elapsedSeconds,
		).toBeGreaterThan(0);
		// live-parameter-adjustment (S-27): the changelog array is present
		// in persisted history on natural completion too, even when empty
		// (no live edit was ever applied to this run).
		expect(
			(row?.history as { parameterChanges?: unknown[] } | null)
				?.parameterChanges,
		).toEqual([]);
		activeRunIds.length = 0; // already finished; nothing left for afterEach to stop
	});

	it("stopServerRun ends the run early with a score from the partial cohesion history", async () => {
		vi.useFakeTimers();
		const { runId } = await insertOwnedRunningRun(2);
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
		expect(row?.history).toMatchObject({
			phaseHistory: expect.any(Array),
			foodRatioSamples: expect.any(Array),
			survivorGenes: expect.any(Array),
		});
		expect(
			(row?.history as { populationCountSamples?: number[] } | null)
				?.populationCountSamples?.length,
		).toBeGreaterThan(0);
		// compare-runs-side-by-side Phase 1: stopServerRun's own write site.
		expect(
			(row?.history as { elapsedSeconds?: number } | null)?.elapsedSeconds,
		).toBeGreaterThan(0);
		// live-parameter-adjustment (S-27): stopServerRun's own write site.
		expect(
			(row?.history as { parameterChanges?: unknown[] } | null)
				?.parameterChanges,
		).toEqual([]);
		activeRunIds.length = 0;
	});

	it("stopServerRun on an unregistered runId is a no-op", async () => {
		await expect(stopServerRun(999_999)).resolves.toBeUndefined();
	});

	it("getLiveRunState returns undefined once a run has stopped", async () => {
		vi.useFakeTimers();
		const { runId } = await insertOwnedRunningRun(3);
		activeRunIds.push(runId);

		startServerRun({ runId, seed: 3, ...BASE_PARAMS });
		expect(getLiveRunState(runId)).toBeDefined();

		await stopServerRun(runId);
		expect(getLiveRunState(runId)).toBeUndefined();
		activeRunIds.length = 0;
	});

	it("a tick that throws stops the run and leaves score null, without crashing", async () => {
		vi.useFakeTimers();
		const { runId } = await insertOwnedRunningRun(5);
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
		// F-05 (MS-08): no history on the tick-error path — the run's own
		// state may be unreliable at that point, same posture as `score`.
		expect(row?.history).toBeNull();
		expect(consoleErrorSpy).toHaveBeenCalled();

		tickSpy.mockRestore();
		consoleErrorSpy.mockRestore();
		activeRunIds.length = 0;
	});

	it("a DB write failure in finishRun is caught and logged, not an unhandled rejection", async () => {
		vi.useFakeTimers();
		const { runId } = await insertOwnedRunningRun(6);
		activeRunIds.push(runId);
		const consoleErrorSpy = vi
			.spyOn(console, "error")
			.mockImplementation(() => undefined);
		const updateSpy = vi.spyOn(db, "update").mockImplementationOnce(() => {
			throw new Error("simulated DB failure");
		});

		startServerRun({ runId, seed: 6, ...BASE_PARAMS, maxDurationSeconds: 600 });
		await expect(stopServerRun(runId)).resolves.toBeUndefined();

		expect(consoleErrorSpy).toHaveBeenCalledWith(
			expect.stringContaining(`server run ${runId}`),
			expect.anything(),
		);

		updateSpy.mockRestore();
		consoleErrorSpy.mockRestore();
		activeRunIds.length = 0; // registry entry already removed by finishRun
	});

	it("stops the run on a population wipe (zero boids) without crashing", async () => {
		vi.useFakeTimers();
		const { runId } = await insertOwnedRunningRun(4);
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

describe("applyLiveParams", () => {
	it("returns false for an unregistered runId", () => {
		expect(applyLiveParams(999_999, { separationWeight: 5 })).toBe(false);
	});

	it("patches run.params and appends a changelog entry with the correct tick/field/oldValue/newValue", async () => {
		vi.useFakeTimers();
		const { runId } = await insertOwnedRunningRun(20);
		activeRunIds.push(runId);
		startServerRun({
			runId,
			seed: 20,
			...BASE_PARAMS,
			maxDurationSeconds: 600,
		});
		await vi.advanceTimersByTimeAsync(64);

		const applied = applyLiveParams(runId, {
			separationWeight: 7,
			foodRegenRate: 42,
		});

		expect(applied).toBe(true);
		const state = getLiveRunState(runId);
		expect(state?.liveParams.separationWeight).toBe(7);
		expect(state?.liveParams.foodRegenRate).toBe(42);
		// Other live-adjustable fields are untouched by a partial patch.
		expect(state?.liveParams.alignmentWeight).toBe(BASE_PARAMS.alignmentWeight);

		await stopServerRun(runId);
		const row = await db.query.simulationRuns.findFirst({
			where: (t, { eq }) => eq(t.id, runId),
		});
		const changes = (
			row?.history as {
				parameterChanges?: ParameterChangeEntry[];
			} | null
		)?.parameterChanges;
		expect(changes).toHaveLength(2);
		expect(changes).toContainEqual({
			tick: expect.any(Number),
			field: "separationWeight",
			oldValue: BASE_PARAMS.separationWeight,
			newValue: 7,
		});
		expect(changes).toContainEqual({
			tick: expect.any(Number),
			field: "foodRegenRate",
			oldValue: BASE_PARAMS.foodRegenRate,
			newValue: 42,
		});
		activeRunIds.length = 0;
	});
});

describe("snapshotServerRun / resumeServerRun", () => {
	it("returns undefined for an unregistered runId", () => {
		expect(snapshotServerRun(999_999)).toBeUndefined();
	});

	it("parameterChanges survives a snapshot/resume round-trip", async () => {
		vi.useFakeTimers();
		const { runId } = await insertOwnedRunningRun(21);
		activeRunIds.push(runId);
		startServerRun({
			runId,
			seed: 21,
			...BASE_PARAMS,
			maxDurationSeconds: 600,
		});
		await vi.advanceTimersByTimeAsync(64);
		applyLiveParams(runId, { separationWeight: 9 });

		const snapshot = snapshotServerRun(runId);
		if (!snapshot) {
			throw new Error("expected a snapshot");
		}
		expect(snapshot.parameterChanges).toHaveLength(1);

		resumeServerRun(runId, snapshot);
		expect(getLiveRunState(runId)?.liveParams.separationWeight).toBe(9);

		await stopServerRun(runId);
		const row = await db.query.simulationRuns.findFirst({
			where: (t, { eq }) => eq(t.id, runId),
		});
		const changes = (
			row?.history as {
				parameterChanges?: ParameterChangeEntry[];
			} | null
		)?.parameterChanges;
		expect(changes).toHaveLength(1);
		expect(changes?.[0]).toMatchObject({
			field: "separationWeight",
			oldValue: BASE_PARAMS.separationWeight,
			newValue: 9,
		});
		activeRunIds.length = 0;
	});

	// Mirrors the `populationDensitySamples`-missing-from-legacy-snapshot
	// regression test below: a `savedState` row written before this field
	// existed has no `parameterChanges` key, so `resumeServerRun` must not
	// crash when reconstructing it.
	it("resuming a snapshot missing parameterChanges (pre-S-27 data) does not crash the run", async () => {
		vi.useFakeTimers();
		const { runId } = await insertOwnedRunningRun(22);
		activeRunIds.push(runId);

		startServerRun({
			runId,
			seed: 22,
			...BASE_PARAMS,
			maxDurationSeconds: 600,
		});
		await vi.advanceTimersByTimeAsync(64);
		const snapshot = snapshotServerRun(runId);
		if (!snapshot) {
			throw new Error("expected a snapshot");
		}

		const legacySnapshot = { ...snapshot } as Partial<ServerRunSnapshot>;
		legacySnapshot.parameterChanges = undefined;
		delete (legacySnapshot as Record<string, unknown>).parameterChanges;

		resumeServerRun(runId, legacySnapshot as ServerRunSnapshot);
		await vi.advanceTimersByTimeAsync(64);

		// If the resumed run crashed on a missing parameterChanges array, a
		// live edit's `.push` below would throw inside applyLiveParams.
		expect(getLiveRunState(runId)).toBeDefined();
		expect(applyLiveParams(runId, { separationWeight: 3 })).toBe(true);

		await stopServerRun(runId);
		activeRunIds.length = 0;
	});

	it("snapshotting removes the run from the live registry without scoring/stopping it", async () => {
		vi.useFakeTimers();
		const { runId } = await insertOwnedRunningRun(11);
		startServerRun({
			runId,
			seed: 11,
			...BASE_PARAMS,
			maxDurationSeconds: 600,
		});
		await vi.advanceTimersByTimeAsync(64);

		const snapshot = snapshotServerRun(runId);

		expect(snapshot).toBeDefined();
		expect(getLiveRunState(runId)).toBeUndefined();
		const row = await db.query.simulationRuns.findFirst({
			where: (t, { eq }) => eq(t.id, runId),
		});
		// snapshotServerRun is a pure in-memory pause — the row is untouched
		// until the caller (the `savePause` procedure) writes `status: "saved"`.
		expect(row?.status).toBe("running");
	});

	it("resumeServerRun reconstructs ticking that continues from exactly the snapshotted state", async () => {
		vi.useFakeTimers();
		const { runId: runIdA } = await insertOwnedRunningRun(12);
		const { runId: runIdB } = await insertOwnedRunningRun(12);
		activeRunIds.push(runIdA, runIdB);

		// Run A: tick uninterrupted for a stretch.
		startServerRun({
			runId: runIdA,
			seed: 12,
			...BASE_PARAMS,
			maxDurationSeconds: 600,
		});
		await vi.advanceTimersByTimeAsync(320);
		const referenceState = getLiveRunState(runIdA);
		expect(referenceState).toBeDefined();

		// Run B: tick for half the stretch, snapshot, resume, then tick the
		// other half — same total elapsed ticking, split by a pause.
		startServerRun({
			runId: runIdB,
			seed: 12,
			...BASE_PARAMS,
			maxDurationSeconds: 600,
		});
		await vi.advanceTimersByTimeAsync(160);
		const snapshot = snapshotServerRun(runIdB);
		if (!snapshot) {
			throw new Error("expected a snapshot");
		}
		expect(getLiveRunState(runIdB)).toBeUndefined();

		resumeServerRun(runIdB, snapshot);
		expect(getLiveRunState(runIdB)).toBeDefined();
		await vi.advanceTimersByTimeAsync(160);

		const resumedState = getLiveRunState(runIdB);
		expect(resumedState?.boids).toEqual(referenceState?.boids);
		expect(resumedState?.predators).toEqual(referenceState?.predators);

		await stopServerRun(runIdA);
		await stopServerRun(runIdB);
		activeRunIds.length = 0;
	});

	// impl-review (area-aware-population-insight, F1): a `savedState` row
	// written by `savePause` before this field existed has no
	// `populationDensitySamples` key — the cast at this function's call site
	// doesn't validate the JSON shape, so this is a real production path, not
	// a hypothetical one. Without the `?? []` fallback, the next tick's spread
	// throws, silently killing the resumed run via `tick()`'s catch block.
	it("resuming a snapshot missing populationDensitySamples (pre-S-25 data) does not crash the run", async () => {
		vi.useFakeTimers();
		const { runId } = await insertOwnedRunningRun(13);
		activeRunIds.push(runId);

		startServerRun({
			runId,
			seed: 13,
			...BASE_PARAMS,
			maxDurationSeconds: 600,
		});
		await vi.advanceTimersByTimeAsync(64);
		const snapshot = snapshotServerRun(runId);
		if (!snapshot) {
			throw new Error("expected a snapshot");
		}

		// Simulate a pre-S-25 saved row: strip the field entirely rather than
		// setting it to `undefined`, matching what a real pre-change JSON blob
		// actually looks like (the key is simply absent, not present-as-undefined).
		const legacySnapshot = { ...snapshot } as Partial<ServerRunSnapshot>;
		legacySnapshot.populationDensitySamples = undefined;
		delete (legacySnapshot as Record<string, unknown>).populationDensitySamples;

		resumeServerRun(runId, legacySnapshot as ServerRunSnapshot);
		await vi.advanceTimersByTimeAsync(64);

		// If the resumed tick had thrown, tick()'s catch block would have
		// called finishRun and removed the run from the live registry.
		expect(getLiveRunState(runId)).toBeDefined();

		await stopServerRun(runId);
		activeRunIds.length = 0;
	});

	// The test above proves continuity when no rng-driven branch (reproduction)
	// fires in the window — it would pass even if resumeServerRun forgot to
	// restore the RNG's state, since plain movement never calls `rng()`. This
	// test manufactures a mate-eligible pair (same shape as
	// single-run-lifecycle.test.ts's reproduction test) so reproduction's
	// rng-driven branches (inheritGenes/mutation/gender rolls) actually fire
	// across the pause, proving `rng.setState` genuinely resumes the sequence
	// rather than restarting it.
	function buildMatingSnapshot(
		runId: number,
		seed: number,
		rngState: number,
	): ServerRunSnapshot {
		const genes: BoidGenes = {
			color: { r: 0, g: 0, b: 0 },
			flockId: 0,
			separationWeight: 0,
			alignmentWeight: 0,
			cohesionWeight: 0,
			maxSpeed: 40,
			minSpeed: 15,
			maxLifespan: 1000,
			matePreference: 0,
		};
		function buildBoid(overrides: Partial<BoidState>): BoidState {
			return {
				x: 0,
				y: 0,
				z: 0,
				vx: 0,
				vy: 0,
				vz: 0,
				lifespan: 1000,
				genes,
				energy: 45,
				age: 0,
				gender: "a",
				...overrides,
			};
		}
		return {
			params: { runId, seed, ...BASE_PARAMS, maxDurationSeconds: 600 },
			rngState,
			boids: [
				// The tracked pair: matures (crosses energyThreshold/
				// MATURITY_AGE_SECONDS) partway through the test, well after
				// the pause point below — this is the pair whose reproduction
				// outcome the test actually compares.
				buildBoid({ x: 100, y: 0, gender: "a" }),
				buildBoid({ x: 105, y: 0, gender: "b" }),
				// A decoy pair, already eligible on tick 1 and far enough away
				// (MATE_DISTANCE_RADIUS=30) not to interact with the tracked
				// pair. Mating it immediately consumes several rng() calls
				// (gene inheritance/mutation/gender rolls) well before the
				// pause, shifting the RNG's actual state away from the raw
				// seed — without this, the tracked pair's later mating would
				// consume the SAME rng state whether or not resumeServerRun
				// restores it (since nothing would have advanced the state yet
				// at the pause point), and the break-check below wouldn't
				// prove anything. A near-zero `genes.maxLifespan` (inherited by
				// its own offspring too) keeps this decoy lineage short-lived —
				// without it, nothing stops the decoys (whose energy/age never
				// reset after mating — see `reproducePopulation`'s own
				// comment) from re-mating every tick for the rest of the test
				// window.
				buildBoid({
					x: 1000,
					y: 1000,
					z: 1000,
					energy: 50,
					age: 5,
					gender: "a",
					genes: { ...genes, maxLifespan: 0.05 },
					lifespan: 0.05,
				}),
				buildBoid({
					x: 1005,
					y: 1000,
					z: 1000,
					energy: 50,
					age: 5,
					gender: "b",
					genes: { ...genes, maxLifespan: 0.05 },
					lifespan: 0.05,
				}),
			],
			predators: [],
			foodStock: BASE_PARAMS.foodStockInitial,
			cohesionSamples: [],
			foodRatioSamples: [],
			populationCountSamples: [],
			populationDensitySamples: [],
			parameterChanges: [],
			phaseHistory: [],
			elapsedSeconds: 0,
			lastTimestamp: null,
			populationCapped: false,
		};
	}

	it("restores the exact RNG sequence across a pause, producing bit-identical reproduction outcomes", async () => {
		vi.useFakeTimers();
		const runIdA = 900_001;
		const runIdB = 900_002;
		activeRunIds.push(runIdA, runIdB);

		// Run A: resume once (from a freshly-built snapshot, rngState = seed),
		// tick straight through to a reproduction event.
		resumeServerRun(runIdA, buildMatingSnapshot(runIdA, 42, 42));
		await vi.advanceTimersByTimeAsync(6000);
		const referenceState = getLiveRunState(runIdA);
		expect(referenceState?.boids.length).toBeGreaterThan(2);

		// Run B: resume, tick partway, pause (snapshot), resume again, tick the
		// rest — same total ticking, split by a pause in between. Both halves
		// are exact multiples of the registry's 16ms tick interval so the
		// split doesn't itself shift which wall-clock instants land on a tick
		// (an artifact of the fake-timer split, not of resume/RNG fidelity).
		resumeServerRun(runIdB, buildMatingSnapshot(runIdB, 42, 42));
		await vi.advanceTimersByTimeAsync(3008);
		const midSnapshot = snapshotServerRun(runIdB);
		if (!midSnapshot) {
			throw new Error("expected a snapshot");
		}
		resumeServerRun(runIdB, midSnapshot);
		await vi.advanceTimersByTimeAsync(2992);

		const resumedState = getLiveRunState(runIdB);
		expect(resumedState?.boids.length).toBeGreaterThan(2);
		expect(resumedState?.boids).toEqual(referenceState?.boids);

		await stopServerRun(runIdA);
		await stopServerRun(runIdB);
		activeRunIds.length = 0;
	});

	it("resumeServerRun throws if the runId is already registered", async () => {
		vi.useFakeTimers();
		const { runId } = await insertOwnedRunningRun(13);
		activeRunIds.push(runId);
		startServerRun({
			runId,
			seed: 13,
			...BASE_PARAMS,
			maxDurationSeconds: 600,
		});
		await vi.advanceTimersByTimeAsync(64);
		const snapshot = snapshotServerRun(runId);
		if (!snapshot) {
			throw new Error("expected a snapshot");
		}
		resumeServerRun(runId, snapshot);
		activeRunIds.length = 1;
		activeRunIds[0] = runId;

		expect(() => resumeServerRun(runId, snapshot)).toThrow(
			/already registered/,
		);
	});
});

describe("watchServerRun", () => {
	it("rejects with FORBIDDEN when userId doesn't match the run's owner", async () => {
		const { runId } = await insertOwnedRunningRun(7);
		activeRunIds.push(runId);

		await expect(
			watchServerRun({ runId, userId: "not-the-owner" }).next(),
		).rejects.toMatchObject({ code: "FORBIDDEN" } satisfies Partial<TRPCError>);
	});

	it("rejects with BAD_REQUEST when the runId doesn't exist", async () => {
		await expect(
			watchServerRun({ runId: 999_999, userId: "whoever" }).next(),
		).rejects.toMatchObject({
			code: "BAD_REQUEST",
		} satisfies Partial<TRPCError>);
	});

	it("rejects with BAD_REQUEST when the run exists but isn't an active server run", async () => {
		const { ownerId, runId } = await insertOwnedRunningRun(8);
		// Deliberately never calling startServerRun — the row exists but
		// nothing is ticking it.
		await expect(
			watchServerRun({ runId, userId: ownerId }).next(),
		).rejects.toMatchObject({
			code: "BAD_REQUEST",
		} satisfies Partial<TRPCError>);
	});

	it("yields snapshots with non-decreasing elapsedSeconds, then ends the stream on stop", async () => {
		vi.useFakeTimers();
		const { ownerId, runId } = await insertOwnedRunningRun(9);
		activeRunIds.push(runId);
		startServerRun({
			runId,
			seed: 9,
			...BASE_PARAMS,
			maxDurationSeconds: 600,
		});

		const iterator = watchServerRun({ runId, userId: ownerId });
		let previousElapsed = -1;
		for (let i = 0; i < 3; i++) {
			const nextPromise = iterator.next();
			await vi.advanceTimersByTimeAsync(150);
			const { value, done } = await nextPromise;
			expect(done).toBeFalsy();
			expect(value?.elapsedSeconds).toBeGreaterThanOrEqual(previousElapsed);
			previousElapsed = value?.elapsedSeconds ?? previousElapsed;
		}

		await stopServerRun(runId);
		const finalPromise = iterator.next();
		await vi.advanceTimersByTimeAsync(150);
		const final = await finalPromise;
		expect(final.done).toBe(true);

		activeRunIds.length = 0;
	});

	it("ends the stream after at most one yield when the signal is already aborted", async () => {
		vi.useFakeTimers();
		const { ownerId, runId } = await insertOwnedRunningRun(10);
		activeRunIds.push(runId);
		startServerRun({
			runId,
			seed: 10,
			...BASE_PARAMS,
			maxDurationSeconds: 600,
		});

		const controller = new AbortController();
		controller.abort();
		const iterator = watchServerRun({
			runId,
			userId: ownerId,
			signal: controller.signal,
		});

		const results: { done?: boolean }[] = [];
		for (let i = 0; i < 2; i++) {
			results.push(await iterator.next());
			if (results.at(-1)?.done) {
				break;
			}
		}
		expect(results.at(-1)?.done).toBe(true);

		await stopServerRun(runId);
		activeRunIds.length = 0;
	});
});
