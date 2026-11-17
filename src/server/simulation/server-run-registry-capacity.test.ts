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

// testing-concurrent-load-capacity Phase 1: a sibling file dedicated to
// aggregate concurrent-load scenarios (Risk #9), not an extension of
// server-run-registry.test.ts — own fixture helper, own module-level
// tracking arrays, own afterEach, same lifecycle shape as the main file.
//
// boidCount/predatorCount are explicit parameters here (not read from a
// fixed BASE_PARAMS constant) so each scenario in this file can size its
// own aggregate population independently of the main file's hardcoded
// 10/2 — this phase's 28/7 split matches the project's existing 80/20
// boid/predator convention (perf-baseline.ts, pipeline-perf.test.ts).
const BASE_PARAMS: Omit<
	ServerRunParams,
	"runId" | "seed" | "boidCount" | "predatorCount"
> = {
	separationWeight: 1,
	alignmentWeight: 1,
	cohesionWeight: 1,
	maxDurationSeconds: 600,
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

const trackedOwnerIds: string[] = [];
const activeRunIds: number[] = [];

// Phase 2: widened with an optional `paramOverrides` (defaults to `{}`, so
// Phase 1's call sites are untouched) so the admission-time-gap scenario can
// reuse this same fixture with a reproduction-favorable params subset
// instead of duplicating the insert — same override-then-insert shape
// simulation.test.ts's own `insertOwnedRunningRun` fixture uses for its
// behavioral-effects tests. Returns the resolved `params` alongside the ids
// so the caller can pass the exact same values to `startServerRun`.
async function insertOwnedRunningRun(
	seed: number,
	boidCount: number,
	predatorCount: number,
	paramOverrides: Partial<
		Omit<ServerRunParams, "runId" | "seed" | "boidCount" | "predatorCount">
	> = {},
) {
	const params = { ...BASE_PARAMS, ...paramOverrides };

	const [owner] = await db
		.insert(users)
		.values({
			email: `registry-capacity-owner-${crypto.randomUUID()}@example.com`,
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
			seed,
			boidCount,
			separationWeight: params.separationWeight,
			alignmentWeight: params.alignmentWeight,
			cohesionWeight: params.cohesionWeight,
			maxDurationSeconds: params.maxDurationSeconds,
			predatorCount,
			protectionThreshold: params.protectionThreshold,
			foodStockInitial: params.foodStockInitial,
			foodRegenRate: params.foodRegenRate,
			flockCount: params.flockCount,
			crossbreedingEnabled: params.crossbreedingEnabled,
			energyThreshold: params.energyThreshold,
			mutationChance: params.mutationChance,
			mutationMagnitude: params.mutationMagnitude,
			status: "running",
		})
		.returning({ id: simulationRuns.id });
	if (!run) {
		throw new Error("failed to insert fixture run");
	}
	return { ownerId: owner.id, runId: run.id, params };
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

describe("server-run-registry concurrent load capacity", () => {
	// Risk #9: proves the real setInterval-based scheduler ticks 4 concurrent
	// server-owned runs together, under one shared fake-time advance, with no
	// backlog, leak, or drop — extends the main file's 2-run concurrent-tick
	// precedent (server-run-registry.test.ts's dense-clustering test) to 4.
	it("ticks 4 concurrent runs together under one fake-time advance with no backlog, leak, or drop", async () => {
		vi.useFakeTimers();

		// boidCount: 28, predatorCount: 7 per run (35 combined, this project's
		// 80/20 convention) — 4 runs x 35 = 140, just under the 150 default
		// population ceiling, so this stays a baseline concurrency proof, not
		// a cap-trimming scenario.
		const seeds = [50, 51, 52, 53];
		const runIds: number[] = [];
		for (const seed of seeds) {
			const { runId } = await insertOwnedRunningRun(seed, 28, 7);
			runIds.push(runId);
			activeRunIds.push(runId);
		}

		for (let i = 0; i < runIds.length; i++) {
			const runId = runIds[i];
			const seed = seeds[i];
			if (runId === undefined || seed === undefined) {
				throw new Error("runIds/seeds length mismatch");
			}
			startServerRun({
				runId,
				seed,
				...BASE_PARAMS,
				boidCount: 28,
				predatorCount: 7,
			});
		}

		for (const runId of runIds) {
			expect(getLiveRunState(runId)).toBeDefined();
		}

		// One shared advance driving all 4 runs' independent intervals
		// together (~300 ticks at TICK_INTERVAL_MS = 16), followed by the
		// existing flush idiom so any fire-and-forget work settles.
		await vi.advanceTimersByTimeAsync(5000);
		await vi.advanceTimersByTimeAsync(0);

		// No-backlog assertion: an identical fake-time advance must leave all
		// 4 runs at the same elapsedSeconds, modulo the legitimate
		// round-robin ordering of 4 independently-registered intervals within
		// one advance — not the real drift this test exists to catch.
		const elapsedByRun = runIds.map((runId) => {
			const snapshot = getLiveRunState(runId);
			expect(snapshot).toBeDefined();
			return snapshot?.elapsedSeconds ?? 0;
		});
		const [first, ...rest] = elapsedByRun;
		if (first === undefined) {
			throw new Error("expected at least one elapsedSeconds sample");
		}
		for (const elapsed of rest) {
			expect(Math.abs(elapsed - first)).toBeLessThanOrEqual(0.05);
		}

		// No-leak/no-drop assertion: stopping all 4 removes both the registry
		// entry and the underlying interval for every run, mirroring the main
		// file's single-run stop assertion across all 4.
		for (const runId of runIds) {
			await stopServerRun(runId);
		}
		for (const runId of runIds) {
			expect(getLiveRunState(runId)).toBeUndefined();
		}
		activeRunIds.length = 0; // already stopped; nothing left for afterEach
	});

	// Risk #9 / research.md §2: proves the confirmed admission-time ceiling
	// gap as an actual test artifact, not prose — `maxConcurrentObjectCount`
	// (default 150) is only ever checked once, at admission
	// (`assertWithinConcurrentObjectCeiling`, simulation.ts), and is never
	// re-validated against already-running runs' own population growth
	// (reproducePopulation, boids.ts). Starts the same 4-run/140-aggregate
	// baseline as the test above, but with reproduction-favorable params, and
	// confirms growth alone can push the live aggregate past 150 with the
	// scheduler itself staying correct throughout — there is no
	// blocking/throttling mechanism to assert triggered; this documents an
	// accepted gap, not a bug with an expected error.
	it("lets live population growth push the aggregate past the 150 ceiling while the scheduler keeps ticking all 4 runs correctly", async () => {
		vi.useFakeTimers();

		// energyThreshold: 1 / foodRegenRate: 50 / foodStockInitial: 200 is
		// this project's own existing convention for a reproduction-reliable
		// fixture (simulation.test.ts's updateRunParams behavioral-effects
		// tests, e.g. the energyThreshold reproduction test) — reused here
		// instead of inventing new values. crossbreedingEnabled is already
		// `true` on BASE_PARAMS.
		const reproParamOverrides = {
			energyThreshold: 1,
			foodRegenRate: 50,
			foodStockInitial: 200,
		};

		const seeds = [60, 61, 62, 63];
		const runIds: number[] = [];
		let resolvedParams:
			| Omit<ServerRunParams, "runId" | "seed" | "boidCount" | "predatorCount">
			| undefined;
		for (const seed of seeds) {
			const { runId, params } = await insertOwnedRunningRun(
				seed,
				28,
				7,
				reproParamOverrides,
			);
			runIds.push(runId);
			activeRunIds.push(runId);
			resolvedParams = params;
		}
		if (!resolvedParams) {
			throw new Error("expected at least one resolved params fixture");
		}

		for (let i = 0; i < runIds.length; i++) {
			const runId = runIds[i];
			const seed = seeds[i];
			if (runId === undefined || seed === undefined) {
				throw new Error("runIds/seeds length mismatch");
			}
			startServerRun({
				runId,
				seed,
				...resolvedParams,
				boidCount: 28,
				predatorCount: 7,
			});
		}

		for (const runId of runIds) {
			expect(getLiveRunState(runId)).toBeDefined();
		}

		// Starting aggregate is 4 x 35 = 140, just under the 150 default
		// ceiling (same baseline as the sibling test above). Growth-only
		// confirmation that at least one run's population has moved past its
		// starting 35 happens via the aggregate assertion below.
		const startingAggregate = runIds.reduce((sum, runId) => {
			const snapshot = getLiveRunState(runId);
			expect(snapshot).toBeDefined();
			return (
				sum + (snapshot ? snapshot.boids.length + snapshot.predators.length : 0)
			);
		}, 0);
		expect(startingAggregate).toBe(140);

		// 8000ms (~500 ticks at TICK_INTERVAL_MS=16) — wider than Phase 1's
		// 5000ms baseline-concurrency budget because this scenario needs
		// visible reproduction growth, not just tick-cadence proof; still the
		// same order of magnitude as the project's own 6000ms reproduction-
		// window convention (simulation.test.ts), widened slightly to cover 4
		// interleaved runs' independent maturity timing rather than one.
		await vi.advanceTimersByTimeAsync(8000);
		await vi.advanceTimersByTimeAsync(0);

		// (a) the gap is real: live aggregate across all 4 runs now exceeds
		// the 150 ceiling purely from reproduction, with no aggregate
		// re-check having intervened.
		const aggregateAfterGrowth = runIds.reduce((sum, runId) => {
			const snapshot = getLiveRunState(runId);
			expect(snapshot).toBeDefined();
			return (
				sum + (snapshot ? snapshot.boids.length + snapshot.predators.length : 0)
			);
		}, 0);
		expect(aggregateAfterGrowth).toBeGreaterThan(150);

		// (b) the scheduler's own correctness is unaffected by the
		// now-exceeded soft ceiling: same no-backlog assertion as the sibling
		// test above (all 4 runs' elapsedSeconds stay in lockstep, modulo
		// legitimate round-robin ordering within one shared advance).
		const elapsedByRun = runIds.map((runId) => {
			const snapshot = getLiveRunState(runId);
			expect(snapshot).toBeDefined();
			return snapshot?.elapsedSeconds ?? 0;
		});
		const [first, ...rest] = elapsedByRun;
		if (first === undefined) {
			throw new Error("expected at least one elapsedSeconds sample");
		}
		for (const elapsed of rest) {
			expect(Math.abs(elapsed - first)).toBeLessThanOrEqual(0.05);
		}

		// Same no-leak/no-drop assertion as the sibling test: stopping all 4
		// removes both the registry entry and the underlying interval for
		// every run. (Separately, and out of this risk's scope per
		// research.md §3/"What We're NOT Doing": `finishRun`'s DB write is
		// fire-and-forget and can leave a row stuck at `status: "running"` on
		// failure — server-run-registry.ts:433-437 — a pre-existing
		// DB/registry divergence bug this test's stop path does not exercise
		// or assert against.)
		for (const runId of runIds) {
			await stopServerRun(runId);
		}
		for (const runId of runIds) {
			expect(getLiveRunState(runId)).toBeUndefined();
		}
		activeRunIds.length = 0; // already stopped; nothing left for afterEach
	}, 60_000);
});
