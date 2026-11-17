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

async function insertOwnedRunningRun(
	seed: number,
	boidCount: number,
	predatorCount: number,
) {
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
			separationWeight: BASE_PARAMS.separationWeight,
			alignmentWeight: BASE_PARAMS.alignmentWeight,
			cohesionWeight: BASE_PARAMS.cohesionWeight,
			maxDurationSeconds: BASE_PARAMS.maxDurationSeconds,
			predatorCount,
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
});
