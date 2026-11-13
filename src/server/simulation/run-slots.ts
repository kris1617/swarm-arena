import type { FlockWeights } from "~/server/simulation/boids";

// S-05 (parallel-sim-switching): a pure, framework-free model of "which runs
// exist, their config, their status, and which one is active" — same style
// as boids.ts's pure stepping functions, so the 4-run cap, active-slot
// switching, and stopped-only dismissal are trivially unit-testable with no
// React or canvas involved.

export type RunSlot = {
	runId: number;
	seed: number;
	boidCount: number;
	weights: FlockWeights;
	maxDurationSeconds: number;
	status: "running" | "stopped";
	score?: number;
	// Added for genetic-inheritance-crossbreeding Phase 2's mid-implementation
	// addition: multi-run slots now seed/tick predators and food identically
	// to single-run, via the same shared `runTick` pipeline
	// (multi-run-lifecycle.ts). `multi/page.tsx`'s start form now collects
	// these fields directly (Phase 6), matching `page.tsx`'s field set.
	predatorCount: number;
	protectionThreshold: number;
	foodStockInitial: number;
	foodRegenRate: number;
	// Added for genetic-inheritance-crossbreeding Phase 6: the five run-level
	// genetics fields (decision #10), threaded from multi/page.tsx's start
	// form into multi-run-lifecycle.ts's per-slot createInitialPopulation/
	// createInitialPredators and runTick calls — same fields single-run's
	// SimulationCanvasProps now carries.
	flockCount: number;
	crossbreedingEnabled: boolean;
	energyThreshold: number;
	mutationChance: number;
	mutationMagnitude: number;
};

export type RunSlotsState = {
	slots: RunSlot[];
	activeRunId: number | null;
};

// Keeps worst-case total simulated objects bounded and the switcher UI
// simple — see plan.md "Key Decisions Made".
export const MAX_PARALLEL_RUNS = 4;

/**
 * Appends a new `"running"` slot and makes it active. Returns `state`
 * unchanged once `MAX_PARALLEL_RUNS` slots already exist — the caller is
 * responsible for not offering the start form at the cap (see the
 * `/simulation/multi` route).
 */
export function addSlot(
	state: RunSlotsState,
	slot: Omit<RunSlot, "status">,
): RunSlotsState {
	if (state.slots.length >= MAX_PARALLEL_RUNS) {
		return state;
	}
	const newSlot: RunSlot = { ...slot, status: "running" };
	return {
		slots: [...state.slots, newSlot],
		activeRunId: newSlot.runId,
	};
}

/**
 * Changes only `activeRunId`. No-op if `runId` isn't present among the
 * current slots.
 */
export function setActive(state: RunSlotsState, runId: number): RunSlotsState {
	if (!state.slots.some((slot) => slot.runId === runId)) {
		return state;
	}
	return { ...state, activeRunId: runId };
}

/**
 * Flips the matching slot's `status` to `"stopped"` and sets its `score`.
 * `score` is `undefined` when the run was force-finished after its stop
 * mutation errored (see `MultiSimulationStage`'s `onError` path) — the slot
 * still reaches a dismissable terminal state even though no real score was
 * recorded. No-op if `runId` isn't present or the slot is already `"stopped"`.
 */
export function markStopped(
	state: RunSlotsState,
	runId: number,
	score: number | undefined,
): RunSlotsState {
	const target = state.slots.find((slot) => slot.runId === runId);
	if (!target || target.status === "stopped") {
		return state;
	}
	return {
		...state,
		slots: state.slots.map((slot) =>
			slot.runId === runId ? { ...slot, status: "stopped", score } : slot,
		),
	};
}

/**
 * Removes the matching slot only if its `status` is `"stopped"` — dismissing
 * a live simulation without going through `markStopped`/the server `stop`
 * call first is not a supported transition, so a `"running"` slot is a
 * no-op. If the removed slot was active, `activeRunId` becomes the first
 * remaining slot's `runId`, or `null` if none remain.
 */
export function removeSlot(state: RunSlotsState, runId: number): RunSlotsState {
	const target = state.slots.find((slot) => slot.runId === runId);
	if (target?.status !== "stopped") {
		return state;
	}
	const remainingSlots = state.slots.filter((slot) => slot.runId !== runId);
	const activeRunId =
		state.activeRunId === runId
			? (remainingSlots[0]?.runId ?? null)
			: state.activeRunId;
	return { slots: remainingSlots, activeRunId };
}
