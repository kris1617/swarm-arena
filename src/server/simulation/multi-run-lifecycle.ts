import {
	type BoidState,
	computeCohesion,
	createInitialPopulation,
	stepBoids,
} from "~/server/simulation/boids";
import { createRng } from "~/server/simulation/rng";
import type { RunSlot } from "~/server/simulation/run-slots";

// Clamp a single frame's dt so a backgrounded/stalled tab can't apply one
// huge physics step when it resumes. This file's own copy — kept independent
// from single-run-lifecycle.ts's identical constant per plan.md "What We're
// NOT Doing".
export const MAX_DT_SECONDS = 0.1;

export type RunState = {
	boids: BoidState[];
	cohesionSamples: number[];
	elapsedSeconds: number;
};

// DOM-free, directly-testable decision core for one tick of
// multi-simulation-stage.tsx's shared RAF loop: which run-states exist
// (seeding new ones, dropping dismissed ones), which "running" slots step and
// which of those should stop this tick, and which slot's boids the caller
// should draw. Mirrors single-run-lifecycle.ts's dt-computation pattern but
// models per-slot state as a plain, immutably-updated Record — never
// mutating the input `state.runStates` or any RunState it contains — per
// run-slots.ts's established convention.
export function computeMultiRunTick(
	state: { runStates: Record<number, RunState>; lastTimestamp: number | null },
	timestamp: number,
	slots: RunSlot[],
	activeRunId: number | null,
	manualStopRequestId: number | null,
): {
	runStates: Record<number, RunState>;
	lastTimestamp: number;
	slotsToStop: RunSlot[];
	activeDrawBoids: BoidState[] | null;
	nextManualStopRequestId: number | null;
} {
	// A fresh first call has no prior frame to diff against, so treat it as
	// dtSeconds = 0 rather than applying a huge dt derived from an absolute
	// epoch timestamp — matches single-run-lifecycle.ts's identical pattern.
	const previousTimestamp =
		state.lastTimestamp === null ? timestamp : state.lastTimestamp;
	const dtSeconds = Math.min(
		(timestamp - previousTimestamp) / 1000,
		MAX_DT_SECONDS,
	);

	const liveRunIds = new Set(slots.map((slot) => slot.runId));
	let nextRunStates: Record<number, RunState> = {};
	for (const [runIdKey, runState] of Object.entries(state.runStates)) {
		const runId = Number(runIdKey);
		// Drop entries for slots removed from `slots` (dismissed) so the
		// record doesn't grow unboundedly across a long session.
		if (liveRunIds.has(runId)) {
			nextRunStates[runId] = runState;
		}
	}

	const slotsToStop: RunSlot[] = [];
	let nextManualStopRequestId = manualStopRequestId;

	for (const slot of slots) {
		if (slot.status !== "running") {
			continue;
		}

		let runState = nextRunStates[slot.runId];
		if (!runState) {
			// Generous relative to maxDurationSeconds so natural lifespan decay
			// doesn't cut the run shorter than the duration the member chose.
			const maxLifespan = Math.max(60, slot.maxDurationSeconds);
			runState = {
				boids: createInitialPopulation(
					slot.boidCount,
					createRng(slot.seed),
					maxLifespan,
				),
				cohesionSamples: [],
				elapsedSeconds: 0,
			};
		}

		const nextBoids = stepBoids(runState.boids, slot.weights, dtSeconds);
		const nextRunState: RunState = {
			boids: nextBoids,
			cohesionSamples: [
				...runState.cohesionSamples,
				computeCohesion(nextBoids),
			],
			elapsedSeconds: runState.elapsedSeconds + dtSeconds,
		};
		nextRunStates = { ...nextRunStates, [slot.runId]: nextRunState };

		if (
			nextRunState.elapsedSeconds >= slot.maxDurationSeconds ||
			nextBoids.length === 0 ||
			manualStopRequestId === slot.runId
		) {
			slotsToStop.push(slot);
			nextManualStopRequestId = null;
		}
	}

	const activeRunState =
		activeRunId !== null ? nextRunStates[activeRunId] : undefined;

	return {
		runStates: nextRunStates,
		lastTimestamp: timestamp,
		slotsToStop,
		activeDrawBoids: activeRunState ? activeRunState.boids : null,
		nextManualStopRequestId,
	};
}
