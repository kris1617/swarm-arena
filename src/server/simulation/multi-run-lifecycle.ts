import {
	type BoidState,
	computeCohesion,
	createInitialPopulation,
	createInitialPredators,
	type PredatorState,
	runTick,
} from "~/server/simulation/boids";
import { createRng } from "~/server/simulation/rng";
import type { RunSlot } from "~/server/simulation/run-slots";

// Clamp a single frame's dt so a backgrounded/stalled tab can't apply one
// huge physics step when it resumes. This file's own copy — kept independent
// from single-run-lifecycle.ts's identical constant per plan.md "What We're
// NOT Doing".
export const MAX_DT_SECONDS = 0.1;

// Same tick-state shape as single-run-lifecycle.ts's — the
// genetic-inheritance-crossbreeding plan's mid-implementation addition makes
// multi-run adopt the identical `runTick` pipeline (predators, food,
// reproduction), not a boid-only subset.
export type RunState = {
	boids: BoidState[];
	predators: PredatorState[];
	foodStock: number;
	// Persisted once at first-seed time per slot (Phase 3 note: never
	// recreated on later ticks) so reproduction's mutation/gender rolls draw
	// from one continuous stream, not a fresh one every tick.
	rng: () => number;
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
	// One entry per "running" slot ticked this call, sourced from that slot's
	// own runTick result (boidsCapped || predatorsCapped) — same per-slot
	// Record idiom as `runStates` above, not persisted on RunState itself
	// since this is a tick-local flag, not state a later tick needs to read
	// back.
	populationCappedBySlot: Record<number, boolean>;
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
	const nextRunStates: Record<number, RunState> = {};
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
	const populationCappedBySlot: Record<number, boolean> = {};

	for (const slot of slots) {
		if (slot.status !== "running") {
			continue;
		}

		let runState = nextRunStates[slot.runId];
		if (!runState) {
			// Generous relative to maxDurationSeconds so natural lifespan decay
			// doesn't cut the run shorter than the duration the member chose.
			const maxLifespan = Math.max(60, slot.maxDurationSeconds);
			// Created once, here, at first-seed time — stored on RunState and
			// never recreated on a later tick (Phase 3 persistence note above).
			const rng = createRng(slot.seed);
			runState = {
				// TODO(phase 6): single-flock placeholder (flockCount: 1) until
				// the multi-run form exposes real flock-count/weights config.
				boids: createInitialPopulation(slot.boidCount, rng, maxLifespan, 1, [
					slot.weights,
				]),
				predators: createInitialPredators(
					slot.predatorCount,
					rng,
					maxLifespan,
					1,
					[slot.weights],
				),
				foodStock: slot.foodStockInitial,
				rng,
				cohesionSamples: [],
				elapsedSeconds: 0,
			};
		}

		// The same composed pipeline single-run-lifecycle.ts's
		// computeSingleRunTick uses — no separate multi-run reproduction
		// implementation to maintain.
		const tickResult = runTick(
			{
				boids: runState.boids,
				predators: runState.predators,
				foodStock: runState.foodStock,
			},
			{
				dtSeconds,
				foodRegenRate: slot.foodRegenRate,
				protectionThreshold: slot.protectionThreshold,
				rng: runState.rng,
				// TODO(phase 6): placeholder reproduction config until the
				// multi-run form exposes real crossbreeding/energy/mutation
				// fields — mirrors single-run-lifecycle.ts's identical
				// placeholder.
				crossbreedingEnabled: true,
				energyThreshold: 50,
				mutationChance: 0.1,
				mutationMagnitude: 0.2,
				populationCap: 500,
				foodStockInitial: slot.foodStockInitial,
			},
		);
		const nextRunState: RunState = {
			boids: tickResult.boids,
			predators: tickResult.predators,
			foodStock: tickResult.foodStock,
			rng: runState.rng,
			cohesionSamples: [
				...runState.cohesionSamples,
				computeCohesion(tickResult.boids),
			],
			elapsedSeconds: runState.elapsedSeconds + dtSeconds,
		};
		nextRunStates[slot.runId] = nextRunState;
		populationCappedBySlot[slot.runId] = tickResult.populationCapped;

		if (
			nextRunState.elapsedSeconds >= slot.maxDurationSeconds ||
			tickResult.boids.length === 0 ||
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
		populationCappedBySlot,
	};
}
