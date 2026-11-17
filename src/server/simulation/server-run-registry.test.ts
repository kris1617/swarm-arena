import type { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";

import { db } from "~/server/db";
import { simulationRuns, users } from "~/server/db/schema";
import {
	type BoidGenes,
	type BoidState,
	INITIAL_ENERGY,
} from "~/server/simulation/boids";
import {
	adjustLivePopulation,
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

// refactor-opportunities Phase 1: exact `{ score, history }` fixtures
// captured by running this file's own "natural completion" (seed 1) and
// "stopServerRun" (seed 2) tests against the pre-refactor code — pins every
// one of the 8 `history` fields plus `score`, not just "is an array"/"is a
// number", so extracting `buildFinishPayload` in server-run-registry.ts
// (Candidate C) is provably behavior-preserving. Deterministic because
// `createRng(seed)` and every `BASE_PARAMS` value are fixed.
const EXPECTED_NATURAL_COMPLETION_FINISH = JSON.parse(
	'{"score":0.18287879445661498,"history":{"phaseHistory":["establishment","establishment","establishment","establishment","establishment","establishment","establishment","establishment","establishment","establishment","establishment","establishment","establishment","establishment","establishment","establishment","establishment","establishment","establishment","growth","growth","growth","growth","growth","growth","growth","growth","growth","growth","growth","growth","growth","growth","growth","growth","growth","growth","growth","growth","growth","growth","growth","growth","growth","growth","growth","growth","growth","growth","growth","growth","growth","growth","growth","growth","growth","growth","growth","growth","growth","growth","growth","growth","growth"],"foodRatioSamples":[1,0.99936,0.9987200000000002,0.9980800000000002,0.9974400000000003,0.9968000000000004,0.9961600000000004,0.9955200000000005,0.9948800000000005,0.9942400000000007,0.9936000000000007,0.9929600000000007,0.9923200000000009,0.9916800000000009,0.991040000000001,0.9904000000000011,0.9897600000000011,0.9891200000000012,0.9884800000000012,0.9878400000000014,0.9872000000000014,0.9865600000000014,0.9859200000000016,0.9852800000000016,0.9846400000000017,0.9840000000000018,0.9833600000000018,0.9827200000000019,0.982080000000002,0.9814400000000021,0.9808000000000021,0.9801600000000021,0.9795200000000023,0.9788800000000023,0.9782400000000024,0.9776000000000025,0.9769600000000025,0.9763200000000026,0.9756800000000027,0.9750400000000028,0.9744000000000028,0.9737600000000028,0.973120000000003,0.972480000000003,0.9718400000000031,0.9712000000000032,0.9705600000000032,0.9699200000000033,0.9692800000000034,0.9686400000000035,0.9680000000000035,0.9673600000000036,0.9667200000000037,0.9660800000000037,0.9654400000000039,0.9648000000000039,0.9641600000000039,0.963520000000004,0.9628800000000041,0.9622400000000042,0.9616000000000042,0.9609600000000043,0.9603200000000044,0.9596800000000044],"survivorGenes":[{"color":{"r":0.2196078431372549,"g":0.7411764705882353,"b":0.9725490196078431},"flockId":0,"separationWeight":1,"alignmentWeight":1,"cohesionWeight":1,"maxSpeed":40,"minSpeed":15,"maxLifespan":60,"matePreference":0.6128388606011868},{"color":{"r":0.2196078431372549,"g":0.7411764705882353,"b":0.9725490196078431},"flockId":0,"separationWeight":1,"alignmentWeight":1,"cohesionWeight":1,"maxSpeed":40,"minSpeed":15,"maxLifespan":60,"matePreference":0.24752389639616013},{"color":{"r":0.2196078431372549,"g":0.7411764705882353,"b":0.9725490196078431},"flockId":0,"separationWeight":1,"alignmentWeight":1,"cohesionWeight":1,"maxSpeed":40,"minSpeed":15,"maxLifespan":60,"matePreference":0.042729709995910525},{"color":{"r":0.2196078431372549,"g":0.7411764705882353,"b":0.9725490196078431},"flockId":0,"separationWeight":1,"alignmentWeight":1,"cohesionWeight":1,"maxSpeed":40,"minSpeed":15,"maxLifespan":60,"matePreference":0.758442840538919},{"color":{"r":0.2196078431372549,"g":0.7411764705882353,"b":0.9725490196078431},"flockId":0,"separationWeight":1,"alignmentWeight":1,"cohesionWeight":1,"maxSpeed":40,"minSpeed":15,"maxLifespan":60,"matePreference":0.15327094192616642},{"color":{"r":0.865,"g":0.4285937500000001,"b":0.2350000000000001},"flockId":1,"separationWeight":1,"alignmentWeight":1,"cohesionWeight":1,"maxSpeed":40,"minSpeed":15,"maxLifespan":60,"matePreference":0.2646576233673841},{"color":{"r":0.865,"g":0.4285937500000001,"b":0.2350000000000001},"flockId":1,"separationWeight":1,"alignmentWeight":1,"cohesionWeight":1,"maxSpeed":40,"minSpeed":15,"maxLifespan":60,"matePreference":0.30237284884788096},{"color":{"r":0.865,"g":0.4285937500000001,"b":0.2350000000000001},"flockId":1,"separationWeight":1,"alignmentWeight":1,"cohesionWeight":1,"maxSpeed":40,"minSpeed":15,"maxLifespan":60,"matePreference":0.11480565904639661},{"color":{"r":0.865,"g":0.4285937500000001,"b":0.2350000000000001},"flockId":1,"separationWeight":1,"alignmentWeight":1,"cohesionWeight":1,"maxSpeed":40,"minSpeed":15,"maxLifespan":60,"matePreference":0.1662571767810732},{"color":{"r":0.865,"g":0.4285937500000001,"b":0.2350000000000001},"flockId":1,"separationWeight":1,"alignmentWeight":1,"cohesionWeight":1,"maxSpeed":40,"minSpeed":15,"maxLifespan":60,"matePreference":0.40124258142895997}],"populationCountSamples":[10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10],"populationDensitySamples":[0.0000015,0.0000015,0.0000015,0.0000015,0.0000015,0.0000015,0.0000015,0.0000015,0.0000015,0.0000015,0.0000015,0.0000015,0.0000015,0.0000015,0.0000015,0.0000015,0.0000015,0.0000015,0.0000015,0.0000015,0.0000015,0.0000015,0.0000015,0.0000015,0.0000015,0.0000015,0.0000015,0.0000015,0.0000015,0.0000015,0.0000015,0.0000015,0.0000015,0.0000015,0.0000015,0.0000015,0.0000015,0.0000015,0.0000015,0.0000015,0.0000015,0.0000015,0.0000015,0.0000015,0.0000015,0.0000015,0.0000015,0.0000015,0.0000015,0.0000015,0.0000015,0.0000015,0.0000015,0.0000015,0.0000015,0.0000015,0.0000015,0.0000015,0.0000015,0.0000015,0.0000015,0.0000015,0.0000015,0.0000015],"geneticDiversitySamples":[0.21743583728688515,0.21743583728688515,0.21743583728688515,0.21743583728688515,0.21743583728688515,0.21743583728688515,0.21743583728688515,0.21743583728688515,0.21743583728688515,0.21743583728688515,0.21743583728688515,0.21743583728688515,0.21743583728688515,0.21743583728688515,0.21743583728688515,0.21743583728688515,0.21743583728688515,0.21743583728688515,0.21743583728688515,0.21743583728688515,0.21743583728688515,0.21743583728688515,0.21743583728688515,0.21743583728688515,0.21743583728688515,0.21743583728688515,0.21743583728688515,0.21743583728688515,0.21743583728688515,0.21743583728688515,0.21743583728688515,0.21743583728688515,0.21743583728688515,0.21743583728688515,0.21743583728688515,0.21743583728688515,0.21743583728688515,0.21743583728688515,0.21743583728688515,0.21743583728688515,0.21743583728688515,0.21743583728688515,0.21743583728688515,0.21743583728688515,0.21743583728688515,0.21743583728688515,0.21743583728688515,0.21743583728688515,0.21743583728688515,0.21743583728688515,0.21743583728688515,0.21743583728688515,0.21743583728688515,0.21743583728688515,0.21743583728688515,0.21743583728688515,0.21743583728688515,0.21743583728688515,0.21743583728688515,0.21743583728688515,0.21743583728688515,0.21743583728688515,0.21743583728688515,0.21743583728688515],"parameterChanges":[],"elapsedSeconds":1.0080000000000007}}',
) as { score: number; history: Record<string, unknown> };

// refactor-opportunities Phase 1: same posture as
// EXPECTED_NATURAL_COMPLETION_FINISH, captured from this file's own
// "stopServerRun ends the run early" test (seed 2, 10 ticks before the
// manual stop) against the pre-refactor code.
const EXPECTED_MANUAL_STOP_FINISH = JSON.parse(
	'{"score":0.014292235526216173,"history":{"phaseHistory":["establishment","establishment","establishment","establishment","establishment","establishment","establishment","establishment","establishment","establishment"],"foodRatioSamples":[1,0.99936,0.9987200000000002,0.9980800000000002,0.9974400000000003,0.9968000000000004,0.9961600000000004,0.9955200000000005,0.9948800000000005,0.9942400000000007],"survivorGenes":[{"color":{"r":0.2196078431372549,"g":0.7411764705882353,"b":0.9725490196078431},"flockId":0,"separationWeight":1,"alignmentWeight":1,"cohesionWeight":1,"maxSpeed":40,"minSpeed":15,"maxLifespan":600,"matePreference":0.4992015736643225},{"color":{"r":0.2196078431372549,"g":0.7411764705882353,"b":0.9725490196078431},"flockId":0,"separationWeight":1,"alignmentWeight":1,"cohesionWeight":1,"maxSpeed":40,"minSpeed":15,"maxLifespan":600,"matePreference":0.5813204094301909},{"color":{"r":0.2196078431372549,"g":0.7411764705882353,"b":0.9725490196078431},"flockId":0,"separationWeight":1,"alignmentWeight":1,"cohesionWeight":1,"maxSpeed":40,"minSpeed":15,"maxLifespan":600,"matePreference":0.1280244740191847},{"color":{"r":0.2196078431372549,"g":0.7411764705882353,"b":0.9725490196078431},"flockId":0,"separationWeight":1,"alignmentWeight":1,"cohesionWeight":1,"maxSpeed":40,"minSpeed":15,"maxLifespan":600,"matePreference":0.4679630333557725},{"color":{"r":0.2196078431372549,"g":0.7411764705882353,"b":0.9725490196078431},"flockId":0,"separationWeight":1,"alignmentWeight":1,"cohesionWeight":1,"maxSpeed":40,"minSpeed":15,"maxLifespan":600,"matePreference":0.0006261211819946766},{"color":{"r":0.865,"g":0.4285937500000001,"b":0.2350000000000001},"flockId":1,"separationWeight":1,"alignmentWeight":1,"cohesionWeight":1,"maxSpeed":40,"minSpeed":15,"maxLifespan":600,"matePreference":0.7779713058844209},{"color":{"r":0.865,"g":0.4285937500000001,"b":0.2350000000000001},"flockId":1,"separationWeight":1,"alignmentWeight":1,"cohesionWeight":1,"maxSpeed":40,"minSpeed":15,"maxLifespan":600,"matePreference":0.8388770050369203},{"color":{"r":0.865,"g":0.4285937500000001,"b":0.2350000000000001},"flockId":1,"separationWeight":1,"alignmentWeight":1,"cohesionWeight":1,"maxSpeed":40,"minSpeed":15,"maxLifespan":600,"matePreference":0.9025776439812034},{"color":{"r":0.865,"g":0.4285937500000001,"b":0.2350000000000001},"flockId":1,"separationWeight":1,"alignmentWeight":1,"cohesionWeight":1,"maxSpeed":40,"minSpeed":15,"maxLifespan":600,"matePreference":0.7991957627236843},{"color":{"r":0.865,"g":0.4285937500000001,"b":0.2350000000000001},"flockId":1,"separationWeight":1,"alignmentWeight":1,"cohesionWeight":1,"maxSpeed":40,"minSpeed":15,"maxLifespan":600,"matePreference":0.9380248752422631}],"populationCountSamples":[10,10,10,10,10,10,10,10,10,10],"populationDensitySamples":[0.0000015,0.0000015,0.0000015,0.0000015,0.0000015,0.0000015,0.0000015,0.0000015,0.0000015,0.0000015],"geneticDiversitySamples":[0.19907661183954461,0.19907661183954461,0.19907661183954461,0.19907661183954461,0.19907661183954461,0.19907661183954461,0.19907661183954461,0.19907661183954461,0.19907661183954461,0.19907661183954461],"parameterChanges":[],"elapsedSeconds":0.14400000000000002}}',
) as { score: number; history: Record<string, unknown> };

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
		// genetic-diversity-trend Phase 1: persisted alongside its siblings,
		// one entry per tick, same non-empty check as populationCountSamples
		// above.
		expect(
			(row?.history as { geneticDiversitySamples?: number[] } | null)
				?.geneticDiversitySamples?.length,
		).toBeGreaterThan(0);
		// refactor-opportunities Phase 1: exact match on every one of the 8
		// `history` fields plus `score` against a fixture captured from this
		// exact scenario before `buildFinishPayload` existed — the guard that
		// extracting it (Candidate C) changes nothing about tick()'s own
		// completion write.
		expect({ score: row?.score, history: row?.history }).toEqual(
			EXPECTED_NATURAL_COMPLETION_FINISH,
		);
		activeRunIds.length = 0; // already finished; nothing left for afterEach to stop
	});

	// genetic-diversity-trend Phase 1: the persisted array must be the exact
	// live array at the point of finishing, not a stale/truncated copy —
	// spies on the shared tick core (pass-through, same posture as the
	// "a tick that throws" test below) to capture the final tick's own
	// result for comparison.
	it("persists geneticDiversitySamples at completion matching the live array at the point of finishing", async () => {
		vi.useFakeTimers();
		const { runId } = await insertOwnedRunningRun(50);
		activeRunIds.push(runId);
		const tickSpy = vi.spyOn(singleRunLifecycle, "computeSingleRunTick");

		startServerRun({ runId, seed: 50, ...BASE_PARAMS });
		await vi.advanceTimersByTimeAsync(3000);
		await vi.advanceTimersByTimeAsync(0);

		const lastCall = tickSpy.mock.results.at(-1);
		if (lastCall?.type !== "return") {
			throw new Error("expected computeSingleRunTick's last call to return");
		}
		const liveGeneticDiversitySamples = lastCall.value.geneticDiversitySamples;
		expect(liveGeneticDiversitySamples.length).toBeGreaterThan(0);

		const row = await db.query.simulationRuns.findFirst({
			where: (t, { eq }) => eq(t.id, runId),
		});
		expect(
			(row?.history as { geneticDiversitySamples?: number[] } | null)
				?.geneticDiversitySamples,
		).toEqual(liveGeneticDiversitySamples);
		activeRunIds.length = 0;
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
		// refactor-opportunities Phase 1: exact match on every one of the 8
		// `history` fields plus `score` against a fixture captured from this
		// exact scenario before `buildFinishPayload` existed — the guard that
		// extracting it (Candidate C) changes nothing about stopServerRun's
		// own completion write.
		expect({ score: row?.score, history: row?.history }).toEqual(
			EXPECTED_MANUAL_STOP_FINISH,
		);
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

	// spatial-grid-dense-clustering-fallback Phase 3: starts two dense,
	// colocated-boid runs ticking together (mirrors this file's own
	// "resumeServerRun reconstructs ticking that continues..." pattern of
	// driving two runs via vi.advanceTimersByTimeAsync) and proves
	// console.warn fires exactly once per run despite many tripping ticks.
	it("logs console.warn exactly once per run even with many dense-clustering ticks, across two runs ticking together", async () => {
		vi.useFakeTimers();
		const warnSpy = vi
			.spyOn(console, "warn")
			.mockImplementation(() => undefined);
		const { runId: runIdA } = await insertOwnedRunningRun(40);
		const { runId: runIdB } = await insertOwnedRunningRun(41);
		activeRunIds.push(runIdA, runIdB);

		// boidCount: 80 colocated boids (createInitialPopulation places them
		// uniformly at random, not colocated — so instead rely on a tiny
		// xyArea/zDepth world, which packs the same count of randomly-placed
		// boids into a volume dense enough to exceed
		// DENSE_CLUSTER_CANDIDATE_CAP (64) in a boid-boid neighbor query).
		startServerRun({
			runId: runIdA,
			seed: 40,
			...BASE_PARAMS,
			boidCount: 80,
			predatorCount: 0,
			maxDurationSeconds: 600,
			xyArea: 1,
			zDepth: 1,
		});
		startServerRun({
			runId: runIdB,
			seed: 41,
			...BASE_PARAMS,
			boidCount: 80,
			predatorCount: 0,
			maxDurationSeconds: 600,
			xyArea: 1,
			zDepth: 1,
		});

		await vi.advanceTimersByTimeAsync(320); // ~20 ticks each, many of which trip the warn-sink

		expect(warnSpy).toHaveBeenCalledTimes(2);
		expect(warnSpy).toHaveBeenCalledWith(
			"dense clustering truncated a spatial-grid query this tick",
		);

		await stopServerRun(runIdA);
		await stopServerRun(runIdB);
		activeRunIds.length = 0;
		warnSpy.mockRestore();
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
	it("returns not-found for an unregistered runId", () => {
		expect(applyLiveParams(999_999, { mutationMagnitude: 5 })).toEqual({
			status: "not-found",
		});
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
			mutationMagnitude: 7,
			foodRegenRate: 42,
		});

		expect(applied).toEqual({ status: "applied" });
		const state = getLiveRunState(runId);
		expect(state?.liveParams.mutationMagnitude).toBe(7);
		expect(state?.liveParams.foodRegenRate).toBe(42);
		// Other live-adjustable fields are untouched by a partial patch.
		expect(state?.liveParams.energyThreshold).toBe(BASE_PARAMS.energyThreshold);

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
			field: "mutationMagnitude",
			oldValue: BASE_PARAMS.mutationMagnitude,
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

	// live-crossbreeding-toggle Phase 1: crossbreedingEnabled is a boolean on
	// run.params, but ParameterChangeEntry.oldValue/newValue are typed
	// number — confirms the generic typeof-coercion in applyLiveParams
	// stores 0/1 in the changelog while run.params itself keeps the real
	// boolean.
	it("coerces a boolean field's oldValue/newValue to 0/1 in the changelog, while run.params stays a real boolean", async () => {
		vi.useFakeTimers();
		const { runId } = await insertOwnedRunningRun(24);
		activeRunIds.push(runId);
		startServerRun({
			runId,
			seed: 24,
			...BASE_PARAMS,
			crossbreedingEnabled: true,
			maxDurationSeconds: 600,
		});
		await vi.advanceTimersByTimeAsync(64);

		const applied = applyLiveParams(runId, { crossbreedingEnabled: false });
		expect(applied).toEqual({ status: "applied" });
		const state = getLiveRunState(runId);
		expect(state?.liveParams.crossbreedingEnabled).toBe(false);

		await stopServerRun(runId);
		const row = await db.query.simulationRuns.findFirst({
			where: (t, { eq }) => eq(t.id, runId),
		});
		const changes = (
			row?.history as {
				parameterChanges?: ParameterChangeEntry[];
			} | null
		)?.parameterChanges;
		expect(changes).toContainEqual({
			tick: expect.any(Number),
			field: "crossbreedingEnabled",
			oldValue: 1,
			newValue: 0,
		});
		activeRunIds.length = 0;
	});

	// impl-review (live-parameter-adjustment, F1): the client's own 500ms
	// Apply cooldown is UI-only — this is the real gate against a direct
	// caller pushing unbounded parameterChanges entries.
	it("throttles a second call within PARAM_UPDATE_THROTTLE_MS of the first", async () => {
		vi.useFakeTimers();
		const { runId } = await insertOwnedRunningRun(23);
		activeRunIds.push(runId);
		startServerRun({
			runId,
			seed: 23,
			...BASE_PARAMS,
			maxDurationSeconds: 600,
		});
		await vi.advanceTimersByTimeAsync(64);

		expect(applyLiveParams(runId, { mutationMagnitude: 2 })).toEqual({
			status: "applied",
		});
		// Immediately retrying, no time advanced — must be throttled, not applied.
		const second = applyLiveParams(runId, { mutationMagnitude: 3 });
		expect(second.status).toBe("throttled");
		if (second.status === "throttled") {
			expect(second.retryAfterMs).toBeGreaterThan(0);
		}
		// The throttled call must not have changed params or logged a change.
		expect(getLiveRunState(runId)?.liveParams.mutationMagnitude).toBe(2);

		await vi.advanceTimersByTimeAsync(500);
		expect(applyLiveParams(runId, { mutationMagnitude: 4 })).toEqual({
			status: "applied",
		});
		expect(getLiveRunState(runId)?.liveParams.mutationMagnitude).toBe(4);

		await stopServerRun(runId);
		activeRunIds.length = 0;
	});
});

describe("adjustLivePopulation", () => {
	it("returns not-found for an unregistered runId", () => {
		expect(adjustLivePopulation(999_999, "boid", 3)).toEqual({
			status: "not-found",
		});
	});

	it("a positive delta appends exactly delta new boids clustered toward the pre-growth centroid", async () => {
		vi.useFakeTimers();
		const { runId } = await insertOwnedRunningRun(30);
		activeRunIds.push(runId);
		startServerRun({
			runId,
			seed: 30,
			...BASE_PARAMS,
			maxDurationSeconds: 600,
		});
		await vi.advanceTimersByTimeAsync(64);

		const before = getLiveRunState(runId);
		if (!before) {
			throw new Error("expected a live run");
		}
		const beforeCount = before.boids.length;
		const centroid = {
			x: before.boids.reduce((s, b) => s + b.x, 0) / before.boids.length,
			y: before.boids.reduce((s, b) => s + b.y, 0) / before.boids.length,
			z: before.boids.reduce((s, b) => s + b.z, 0) / before.boids.length,
		};

		const result = adjustLivePopulation(runId, "boid", 4);
		expect(result).toEqual({ status: "applied" });

		const after = getLiveRunState(runId);
		if (!after) {
			throw new Error("expected a live run");
		}
		expect(after.boids).toHaveLength(beforeCount + 4);
		const added = after.boids.slice(beforeCount);
		expect(added).toHaveLength(4);
		for (const boid of added) {
			const distanceToCentroid = Math.hypot(
				boid.x - centroid.x,
				boid.y - centroid.y,
				boid.z - centroid.z,
			);
			// A plain createInitialPopulation call places a boid uniformly at
			// random across the whole world — on average far from any single
			// point. Clustering halves the gap to the pre-growth centroid, so
			// the added boid must land well inside the world's own diagonal.
			const worldDiagonal = Math.hypot(
				BASE_PARAMS.xyArea,
				BASE_PARAMS.xyArea,
				BASE_PARAMS.zDepth,
			);
			expect(distanceToCentroid).toBeLessThan(worldDiagonal / 2);
			// UI-accepts-input-is-not-feature-verified (lessons.md): a
			// malformed-placeholder newborn (wrong energy/age/genes) would
			// pass the length/position checks above undetected -- assert the
			// actual initialization values a freshly-grown boid must carry,
			// exactly matching createInitialPopulation's own seeding (same
			// posture as INITIAL_ENERGY's export rationale in boids.ts).
			expect(boid.energy).toBe(INITIAL_ENERGY);
			expect(boid.age).toBe(0);
			expect(boid.genes.flockId).toBeGreaterThanOrEqual(0);
			expect(boid.genes.flockId).toBeLessThan(BASE_PARAMS.flockCount);
			// BASE_PARAMS seeds every flock with the same separation/
			// alignment/cohesion weight (adjustLivePopulation's flockWeights
			// derivation, server-run-registry.ts ~line 305), so every added
			// boid's genes must carry those exact run-level weights.
			expect(boid.genes.separationWeight).toBe(BASE_PARAMS.separationWeight);
			expect(boid.genes.alignmentWeight).toBe(BASE_PARAMS.alignmentWeight);
			expect(boid.genes.cohesionWeight).toBe(BASE_PARAMS.cohesionWeight);
			// MAX_SPEED/MIN_SPEED (boids.ts) -- boid-specific cruise-speed
			// bounds createInitialPopulation seeds every new boid's genes
			// with; not exported, so pinned here as the module's own
			// documented constants.
			expect(boid.genes.maxSpeed).toBe(40);
			expect(boid.genes.minSpeed).toBe(15);
			// maxLifespan here is adjustLivePopulation's own
			// `Math.max(60, run.params.maxDurationSeconds)` derivation, not
			// a run-param passthrough -- this run's maxDurationSeconds (600)
			// already exceeds the 60 floor.
			expect(boid.genes.maxLifespan).toBe(600);
			expect(Number.isFinite(boid.genes.matePreference)).toBe(true);
		}

		await stopServerRun(runId);
		activeRunIds.length = 0;
	});

	it("a positive delta on predators appends exactly delta new predators", async () => {
		vi.useFakeTimers();
		const { runId } = await insertOwnedRunningRun(31);
		activeRunIds.push(runId);
		startServerRun({
			runId,
			seed: 31,
			...BASE_PARAMS,
			maxDurationSeconds: 600,
		});
		await vi.advanceTimersByTimeAsync(64);

		const before = getLiveRunState(runId);
		if (!before) {
			throw new Error("expected a live run");
		}
		const beforeCount = before.predators.length;

		const result = adjustLivePopulation(runId, "predator", 2);
		expect(result).toEqual({ status: "applied" });

		const after = getLiveRunState(runId);
		if (!after) {
			throw new Error("expected a live run");
		}
		expect(after.predators).toHaveLength(beforeCount + 2);
		const added = after.predators.slice(beforeCount);
		expect(added).toHaveLength(2);
		for (const predator of added) {
			// UI-accepts-input-is-not-feature-verified (lessons.md): same
			// posture as the boid-growth test above -- a malformed-placeholder
			// newborn predator would pass the length-only check undetected.
			// createInitialPredators (boids.ts) is symmetric with
			// createInitialPopulation per its own "no simpler predator path"
			// comment, so predator genes carry the identical BoidGenes shape --
			// the only per-species difference is maxSpeed/minSpeed using
			// PREDATOR_MAX_SPEED/PREDATOR_MIN_SPEED instead of boids' own
			// MAX_SPEED/MIN_SPEED.
			expect(predator.energy).toBe(INITIAL_ENERGY);
			expect(predator.age).toBe(0);
			expect(predator.genes.flockId).toBeGreaterThanOrEqual(0);
			expect(predator.genes.flockId).toBeLessThan(BASE_PARAMS.flockCount);
			expect(predator.genes.separationWeight).toBe(
				BASE_PARAMS.separationWeight,
			);
			expect(predator.genes.alignmentWeight).toBe(BASE_PARAMS.alignmentWeight);
			expect(predator.genes.cohesionWeight).toBe(BASE_PARAMS.cohesionWeight);
			// PREDATOR_MAX_SPEED/PREDATOR_MIN_SPEED (boids.ts) -- not exported,
			// pinned here as the module's own documented constants.
			expect(predator.genes.maxSpeed).toBe(55);
			expect(predator.genes.minSpeed).toBe(20);
			expect(predator.genes.maxLifespan).toBe(600);
			expect(Number.isFinite(predator.genes.matePreference)).toBe(true);
		}

		await stopServerRun(runId);
		activeRunIds.length = 0;
	});

	it("a negative delta removes exactly |delta| of the lowest-energy boids", async () => {
		vi.useFakeTimers();
		const { runId } = await insertOwnedRunningRun(32);
		activeRunIds.push(runId);
		startServerRun({
			runId,
			seed: 32,
			...BASE_PARAMS,
			maxDurationSeconds: 600,
		});
		await vi.advanceTimersByTimeAsync(64);

		const before = getLiveRunState(runId);
		if (!before) {
			throw new Error("expected a live run");
		}
		// `getLiveRunState` returns the live array by reference (not a clone),
		// so mutating energies here directly sets up the registry's real
		// state — giving each boid an unambiguous, distinct rank. Ticking
		// alone (4 ticks, same dt, no food/predation pressure in this fixture)
		// otherwise leaves every boid's energy identical, which would make
		// any "lowest N" vs. "highest N" cull indistinguishable by energy.
		const expectedLowest = new Set<BoidState>();
		for (const [index, boid] of before.boids.entries()) {
			boid.energy = index;
			if (index < 3) {
				expectedLowest.add(boid);
			}
		}

		const result = adjustLivePopulation(runId, "boid", -3);
		expect(result).toEqual({ status: "applied" });

		const after = getLiveRunState(runId);
		if (!after) {
			throw new Error("expected a live run");
		}
		expect(after.boids).toHaveLength(before.boids.length - 3);
		// Exact-identity oracle (not a mirror of the production sort): the 3
		// boids explicitly assigned the lowest energies above must be exactly
		// the ones gone — this fails if the cull picks the highest-energy
		// individuals instead, or any other subset.
		for (const boid of expectedLowest) {
			expect(after.boids).not.toContain(boid);
		}
		for (const boid of before.boids) {
			if (!expectedLowest.has(boid)) {
				expect(after.boids).toContain(boid);
			}
		}

		await stopServerRun(runId);
		activeRunIds.length = 0;
	});

	it("appends a changelog entry with field boidCount/predatorCount and correct oldValue/newValue", async () => {
		vi.useFakeTimers();
		const { runId } = await insertOwnedRunningRun(33);
		activeRunIds.push(runId);
		startServerRun({
			runId,
			seed: 33,
			...BASE_PARAMS,
			maxDurationSeconds: 600,
		});
		await vi.advanceTimersByTimeAsync(64);
		const beforeCount = getLiveRunState(runId)?.boids.length ?? 0;

		adjustLivePopulation(runId, "boid", 5);

		await stopServerRun(runId);
		const row = await db.query.simulationRuns.findFirst({
			where: (t, { eq }) => eq(t.id, runId),
		});
		const changes = (
			row?.history as {
				parameterChanges?: ParameterChangeEntry[];
			} | null
		)?.parameterChanges;
		expect(changes).toContainEqual({
			tick: expect.any(Number),
			field: "boidCount",
			oldValue: beforeCount,
			newValue: beforeCount + 5,
		});
		activeRunIds.length = 0;
	});

	it("mirrors run.params.boidCount/predatorCount to the new array length", async () => {
		vi.useFakeTimers();
		const { runId } = await insertOwnedRunningRun(34);
		activeRunIds.push(runId);
		startServerRun({
			runId,
			seed: 34,
			...BASE_PARAMS,
			maxDurationSeconds: 600,
		});
		await vi.advanceTimersByTimeAsync(64);

		adjustLivePopulation(runId, "predator", 3);

		const snapshot = snapshotServerRun(runId);
		if (!snapshot) {
			throw new Error("expected a snapshot");
		}
		expect(snapshot.params.predatorCount).toBe(snapshot.predators.length);
		resumeServerRun(runId, snapshot);

		await stopServerRun(runId);
		activeRunIds.length = 0;
	});

	it("throttles a second adjustLivePopulation call within PARAM_UPDATE_THROTTLE_MS of a prior applyLiveParams call", async () => {
		vi.useFakeTimers();
		const { runId } = await insertOwnedRunningRun(35);
		activeRunIds.push(runId);
		startServerRun({
			runId,
			seed: 35,
			...BASE_PARAMS,
			maxDurationSeconds: 600,
		});
		await vi.advanceTimersByTimeAsync(64);

		expect(applyLiveParams(runId, { mutationMagnitude: 2 })).toEqual({
			status: "applied",
		});
		const second = adjustLivePopulation(runId, "boid", 2);
		expect(second.status).toBe("throttled");
		if (second.status === "throttled") {
			expect(second.retryAfterMs).toBeGreaterThan(0);
		}

		await vi.advanceTimersByTimeAsync(500);
		expect(adjustLivePopulation(runId, "boid", 2)).toEqual({
			status: "applied",
		});

		await stopServerRun(runId);
		activeRunIds.length = 0;
	});

	it("clamps a shrink larger than the current array to removing the whole array, resulting length 0", async () => {
		vi.useFakeTimers();
		const { runId } = await insertOwnedRunningRun(36);
		activeRunIds.push(runId);
		startServerRun({
			runId,
			seed: 36,
			...BASE_PARAMS,
			maxDurationSeconds: 600,
		});
		await vi.advanceTimersByTimeAsync(64);

		const result = adjustLivePopulation(runId, "boid", -1000);
		expect(result).toEqual({ status: "applied" });

		const after = getLiveRunState(runId);
		expect(after?.boids).toHaveLength(0);

		await stopServerRun(runId);
		activeRunIds.length = 0;
	});

	it("impl-review F2: a zero delta is a true no-op — no changelog entry, no throttle update", async () => {
		vi.useFakeTimers();
		const { runId } = await insertOwnedRunningRun(37);
		activeRunIds.push(runId);
		startServerRun({
			runId,
			seed: 37,
			...BASE_PARAMS,
			maxDurationSeconds: 600,
		});
		await vi.advanceTimersByTimeAsync(64);

		const before = getLiveRunState(runId);
		if (!before) {
			throw new Error("expected a live run");
		}

		const result = adjustLivePopulation(runId, "boid", 0);
		expect(result).toEqual({ status: "applied" });

		const after = getLiveRunState(runId);
		expect(after?.boids).toHaveLength(before.boids.length);

		// No throttle consumed: a real adjustment immediately afterward must
		// still succeed rather than being throttled by the no-op.
		const second = adjustLivePopulation(runId, "boid", 3);
		expect(second).toEqual({ status: "applied" });

		await stopServerRun(runId);
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
		applyLiveParams(runId, { mutationMagnitude: 9 });

		const snapshot = snapshotServerRun(runId);
		if (!snapshot) {
			throw new Error("expected a snapshot");
		}
		expect(snapshot.parameterChanges).toHaveLength(1);

		resumeServerRun(runId, snapshot);
		expect(getLiveRunState(runId)?.liveParams.mutationMagnitude).toBe(9);

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
			field: "mutationMagnitude",
			oldValue: BASE_PARAMS.mutationMagnitude,
			newValue: 9,
		});
		activeRunIds.length = 0;
	});

	// genetic-diversity-trend Phase 1: same round-trip shape as the
	// parameterChanges test above — tick a stretch, snapshot, confirm the
	// array is non-empty on the snapshot, resume, tick more, confirm the
	// persisted history carries it through (length only grew, never reset).
	it("geneticDiversitySamples survives a snapshot/resume round-trip", async () => {
		vi.useFakeTimers();
		const { runId } = await insertOwnedRunningRun(23);
		activeRunIds.push(runId);
		startServerRun({
			runId,
			seed: 23,
			...BASE_PARAMS,
			maxDurationSeconds: 600,
		});
		await vi.advanceTimersByTimeAsync(64);

		const snapshot = snapshotServerRun(runId);
		if (!snapshot) {
			throw new Error("expected a snapshot");
		}
		expect(snapshot.geneticDiversitySamples.length).toBeGreaterThan(0);
		const samplesAtPause = snapshot.geneticDiversitySamples.length;

		resumeServerRun(runId, snapshot);
		await vi.advanceTimersByTimeAsync(64);

		await stopServerRun(runId);
		const row = await db.query.simulationRuns.findFirst({
			where: (t, { eq }) => eq(t.id, runId),
		});
		const persisted = (
			row?.history as { geneticDiversitySamples?: number[] } | null
		)?.geneticDiversitySamples;
		expect(persisted?.length).toBeGreaterThan(samplesAtPause);
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
		expect(applyLiveParams(runId, { mutationMagnitude: 3 })).toEqual({
			status: "applied",
		});

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

	// parameter-sweep-corpus-generation Phase 1: computeSingleRunTick now
	// mutates its six sample arrays (cohesionSamples, foodRatioSamples,
	// populationCountSamples, populationDensitySamples,
	// geneticDiversitySamples, phaseHistory) in place and returns the same
	// reference, rather than rebuilding a fresh array every tick. That makes
	// `snapshotServerRun`'s returned arrays live references into whatever the
	// run was using — this test proves nothing can retroactively change the
	// values already captured in a snapshot once it's taken: snapshotting one
	// run clears that run's own interval (no further mutation can reach its
	// arrays), and a second, still-ticking run's arrays are entirely separate
	// objects, so ticking it further must never perturb the first run's
	// already-snapshotted values.
	it("snapshotted sample arrays are not retroactively mutated by a different run still ticking", async () => {
		vi.useFakeTimers();
		const { runId: snapshotRunId } = await insertOwnedRunningRun(14);
		const { runId: otherRunId } = await insertOwnedRunningRun(14);
		activeRunIds.push(otherRunId);

		startServerRun({
			runId: snapshotRunId,
			seed: 14,
			...BASE_PARAMS,
			maxDurationSeconds: 600,
		});
		startServerRun({
			runId: otherRunId,
			seed: 14,
			...BASE_PARAMS,
			maxDurationSeconds: 600,
		});
		await vi.advanceTimersByTimeAsync(160);

		const snapshot = snapshotServerRun(snapshotRunId);
		if (!snapshot) {
			throw new Error("expected a snapshot");
		}
		const capturedCohesionSamples = [...snapshot.cohesionSamples];
		const capturedFoodRatioSamples = [...snapshot.foodRatioSamples];
		const capturedPopulationCountSamples = [...snapshot.populationCountSamples];
		const capturedPopulationDensitySamples = [
			...snapshot.populationDensitySamples,
		];
		const capturedGeneticDiversitySamples = [
			...snapshot.geneticDiversitySamples,
		];
		const capturedPhaseHistory = [...snapshot.phaseHistory];

		// Only `otherRunId` is still registered/ticking; `snapshotRunId`'s
		// interval was cleared by `snapshotServerRun` above.
		await vi.advanceTimersByTimeAsync(320);

		expect(snapshot.cohesionSamples).toEqual(capturedCohesionSamples);
		expect(snapshot.foodRatioSamples).toEqual(capturedFoodRatioSamples);
		expect(snapshot.populationCountSamples).toEqual(
			capturedPopulationCountSamples,
		);
		expect(snapshot.populationDensitySamples).toEqual(
			capturedPopulationDensitySamples,
		);
		expect(snapshot.geneticDiversitySamples).toEqual(
			capturedGeneticDiversitySamples,
		);
		expect(snapshot.phaseHistory).toEqual(capturedPhaseHistory);

		await stopServerRun(otherRunId);
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

	// genetic-diversity-trend Phase 1 (lessons.md's S-25 resume-path rule):
	// same regression shape as the populationDensitySamples test above — a
	// `savedState` row written before this field existed has no
	// `geneticDiversitySamples` key, so `resumeServerRun` must not crash
	// when reconstructing it, and a subsequent tick must succeed rather
	// than crashing.
	it("resuming a snapshot missing geneticDiversitySamples (pre-change data) does not crash the run", async () => {
		vi.useFakeTimers();
		const { runId } = await insertOwnedRunningRun(14);
		activeRunIds.push(runId);

		startServerRun({
			runId,
			seed: 14,
			...BASE_PARAMS,
			maxDurationSeconds: 600,
		});
		await vi.advanceTimersByTimeAsync(64);
		const snapshot = snapshotServerRun(runId);
		if (!snapshot) {
			throw new Error("expected a snapshot");
		}

		// Simulate a pre-change saved row: strip the field entirely rather
		// than setting it to `undefined`, matching what a real pre-change
		// JSON blob actually looks like (the key is simply absent, not
		// present-as-undefined).
		const legacySnapshot = { ...snapshot } as Partial<ServerRunSnapshot>;
		legacySnapshot.geneticDiversitySamples = undefined;
		delete (legacySnapshot as Record<string, unknown>).geneticDiversitySamples;

		resumeServerRun(runId, legacySnapshot as ServerRunSnapshot);
		await vi.advanceTimersByTimeAsync(64);

		// If the resumed tick had thrown, tick()'s catch block would have
		// called finishRun and removed the run from the live registry.
		expect(getLiveRunState(runId)).toBeDefined();

		await stopServerRun(runId);
		activeRunIds.length = 0;
	});

	// spatial-grid-dense-clustering-fallback Phase 3: same regression shape
	// as the populationDensitySamples/geneticDiversitySamples tests above —
	// a `savedState` row written before this field existed has no
	// `hasWarnedDenseClustering` key, so `resumeServerRun` must not crash
	// when reconstructing it (falling back to `false` via `?? false`), and a
	// subsequent tick must succeed rather than crashing.
	it("resuming a snapshot missing hasWarnedDenseClustering (pre-change data) does not crash the run", async () => {
		vi.useFakeTimers();
		const { runId } = await insertOwnedRunningRun(14);
		activeRunIds.push(runId);

		startServerRun({
			runId,
			seed: 14,
			...BASE_PARAMS,
			maxDurationSeconds: 600,
		});
		await vi.advanceTimersByTimeAsync(64);
		const snapshot = snapshotServerRun(runId);
		if (!snapshot) {
			throw new Error("expected a snapshot");
		}

		// Simulate a pre-change saved row: strip the field entirely rather
		// than setting it to `undefined`, matching what a real pre-change
		// JSON blob actually looks like (the key is simply absent, not
		// present-as-undefined).
		const legacySnapshot = { ...snapshot } as Partial<ServerRunSnapshot>;
		legacySnapshot.hasWarnedDenseClustering = undefined;
		delete (legacySnapshot as Record<string, unknown>).hasWarnedDenseClustering;

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
			geneticDiversitySamples: [],
			parameterChanges: [],
			phaseHistory: [],
			elapsedSeconds: 0,
			lastTimestamp: null,
			populationCapped: false,
			hasWarnedDenseClustering: false,
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

// unwatched-run-tick-throttling Phase 2: `watcherIds`/`unwatchedSinceMs` are
// internal to `LiveRun` (not exported), so these tests observe their effect
// on `tick()`'s decision instead of reading the Set directly — spying on
// the shared tick core (same posture as the existing "a tick that throws"
// and "persists geneticDiversitySamples..." tests above) to inspect the
// `speedMultiplier` actually passed in on each tick.
describe("unwatched-run tick throttling", () => {
	it("two concurrent watchers keep a run unthrottled past the grace period; once both end and the grace period elapses, throttling engages and the sticky marker is written", async () => {
		vi.useFakeTimers();
		const { ownerId, runId } = await insertOwnedRunningRun(60);
		activeRunIds.push(runId);
		const tickSpy = vi.spyOn(singleRunLifecycle, "computeSingleRunTick");

		startServerRun({
			runId,
			seed: 60,
			...BASE_PARAMS,
			maxDurationSeconds: 600,
		});

		const controllerA = new AbortController();
		const controllerB = new AbortController();
		const iterA = watchServerRun({
			runId,
			userId: ownerId,
			signal: controllerA.signal,
		});
		const iterB = watchServerRun({
			runId,
			userId: ownerId,
			signal: controllerB.signal,
		});

		// Both generators run past their initial DB-read await and attach
		// themselves to the run's watcherIds (watcherIds.size === 2) before
		// any time advances.
		await iterA.next();
		await iterB.next();

		tickSpy.mockClear();
		// Advance well past the 5s grace period while both watchers remain
		// attached — the run must never throttle.
		await vi.advanceTimersByTimeAsync(6000);
		expect(tickSpy.mock.calls.length).toBeGreaterThan(0);
		for (const call of tickSpy.mock.calls) {
			expect(call[2]?.speedMultiplier).toBe(1);
		}

		// End both watchers: abort, then drive each generator through its
		// pending WATCH_INTERVAL_MS wait so the while loop's abort check and
		// the generator's `finally` block (watcherIds.delete) actually run,
		// leaving watcherIds.size === 0.
		controllerA.abort();
		controllerB.abort();
		const doneA = iterA.next();
		const doneB = iterB.next();
		await vi.advanceTimersByTimeAsync(150);
		expect((await doneA).done).toBe(true);
		expect((await doneB).done).toBe(true);

		tickSpy.mockClear();
		// Now genuinely unwatched — advance past the grace period again; a
		// later tick must apply the 3x throttle multiplier.
		await vi.advanceTimersByTimeAsync(6000);
		const throttledCalls = tickSpy.mock.calls.filter(
			(call) => call[2]?.speedMultiplier === 3,
		);
		expect(throttledCalls.length).toBeGreaterThan(0);

		// The sticky marker is written to the DB row the first time
		// throttling actually engages.
		const row = await db.query.simulationRuns.findFirst({
			where: (t, { eq: eqFn }) => eqFn(t.id, runId),
		});
		expect(row?.wasEverThrottled).toBe(true);

		await stopServerRun(runId);
		activeRunIds.length = 0;
	}, 15_000);

	it("a run that goes from watched to unwatched does not throttle before the grace period elapses, but does at/after it", async () => {
		vi.useFakeTimers();
		const { ownerId, runId } = await insertOwnedRunningRun(61);
		activeRunIds.push(runId);
		const tickSpy = vi.spyOn(singleRunLifecycle, "computeSingleRunTick");

		startServerRun({
			runId,
			seed: 61,
			...BASE_PARAMS,
			maxDurationSeconds: 600,
		});

		// Watch, then unwatch — `unwatchedSinceMs` only ever becomes
		// non-null via this transition (a run that was never watched at all
		// has no "transition to empty" to record).
		const controller = new AbortController();
		const iterator = watchServerRun({
			runId,
			userId: ownerId,
			signal: controller.signal,
		});
		await iterator.next();
		controller.abort();
		const done = iterator.next();
		await vi.advanceTimersByTimeAsync(150);
		expect((await done).done).toBe(true);

		tickSpy.mockClear();
		// Just under the 5s grace period since unwatching — still within
		// grace; every tick so far must be unthrottled.
		await vi.advanceTimersByTimeAsync(4800);
		expect(tickSpy.mock.calls.length).toBeGreaterThan(0);
		for (const call of tickSpy.mock.calls) {
			expect(call[2]?.speedMultiplier).toBe(1);
		}

		tickSpy.mockClear();
		// Cross the grace period.
		await vi.advanceTimersByTimeAsync(400);
		const throttledCalls = tickSpy.mock.calls.filter(
			(call) => call[2]?.speedMultiplier === 3,
		);
		expect(throttledCalls.length).toBeGreaterThan(0);

		await stopServerRun(runId);
		activeRunIds.length = 0;
	});

	it("re-watching a previously-throttled run resets unwatchedSinceMs so it keeps ticking unthrottled", async () => {
		vi.useFakeTimers();
		const { ownerId, runId } = await insertOwnedRunningRun(62);
		activeRunIds.push(runId);
		const tickSpy = vi.spyOn(singleRunLifecycle, "computeSingleRunTick");

		startServerRun({
			runId,
			seed: 62,
			...BASE_PARAMS,
			maxDurationSeconds: 600,
		});

		// Watch, then unwatch, then cross the grace period — confirm
		// throttling engaged first, so re-watching below is a genuine reset,
		// not a no-op.
		const setupController = new AbortController();
		const setupIterator = watchServerRun({
			runId,
			userId: ownerId,
			signal: setupController.signal,
		});
		await setupIterator.next();
		setupController.abort();
		const setupDone = setupIterator.next();
		await vi.advanceTimersByTimeAsync(150);
		expect((await setupDone).done).toBe(true);

		await vi.advanceTimersByTimeAsync(5200);
		expect(
			tickSpy.mock.calls.some((call) => call[2]?.speedMultiplier === 3),
		).toBe(true);

		const controller = new AbortController();
		const iterator = watchServerRun({
			runId,
			userId: ownerId,
			signal: controller.signal,
		});
		await iterator.next();

		tickSpy.mockClear();
		// Re-watched: even well past the grace window, the run must not
		// throttle again while a watcher is attached.
		await vi.advanceTimersByTimeAsync(6000);
		expect(tickSpy.mock.calls.length).toBeGreaterThan(0);
		for (const call of tickSpy.mock.calls) {
			expect(call[2]?.speedMultiplier).toBe(1);
		}

		controller.abort();
		const done = iterator.next();
		await vi.advanceTimersByTimeAsync(150);
		expect((await done).done).toBe(true);

		await stopServerRun(runId);
		activeRunIds.length = 0;
	});
});
