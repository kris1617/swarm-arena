import {
	type BoidState,
	computeCohesion,
	type FlockWeights,
	type PredatorState,
	runTick,
} from "~/server/simulation/boids";

// Clamp a single frame's dt so a backgrounded/stalled tab can't apply one
// huge physics step when it resumes. Moved from simulation-canvas.tsx so the
// decision core (this file) and the canvas/RAF/tRPC shell (that file) share
// one source of truth for the value.
export const MAX_DT_SECONDS = 0.1;

// DOM-free, directly-testable decision core for one tick of a single run:
// dt computation, the composed runTick call, next-state derivation, and the
// stop-on-duration/stop-on-population-wipe decision — separated from the
// canvas/RAF/tRPC shell in simulation-canvas.tsx that must stay behind.
export function computeSingleRunTick(
	state: {
		boids: BoidState[];
		predators: PredatorState[];
		foodStock: number;
		cohesionSamples: number[];
		elapsedSeconds: number;
		lastTimestamp: number | null;
	},
	timestamp: number,
	params: {
		weights: FlockWeights;
		foodRegenRate: number;
		protectionThreshold: number;
		maxDurationSeconds: number;
	},
): {
	boids: BoidState[];
	predators: PredatorState[];
	foodStock: number;
	cohesionSamples: number[];
	elapsedSeconds: number;
	lastTimestamp: number;
	shouldStop: boolean;
} {
	// A fresh first call has no prior frame to diff against, so treat it as
	// dtSeconds = 0 rather than applying a huge dt derived from an absolute
	// epoch timestamp — matches the component's prior
	// `if (lastTimestampRef.current === null) lastTimestampRef.current = timestamp;`.
	const previousTimestamp =
		state.lastTimestamp === null ? timestamp : state.lastTimestamp;
	const dtSeconds = Math.min(
		(timestamp - previousTimestamp) / 1000,
		MAX_DT_SECONDS,
	);

	const {
		boids: nextBoids,
		predators: nextPredators,
		foodStock: nextFoodStock,
	} = runTick(
		{
			boids: state.boids,
			predators: state.predators,
			foodStock: state.foodStock,
		},
		{
			weights: params.weights,
			dtSeconds,
			foodRegenRate: params.foodRegenRate,
			protectionThreshold: params.protectionThreshold,
		},
	);

	const nextCohesionSamples = [
		...state.cohesionSamples,
		computeCohesion(nextBoids),
	];
	const nextElapsedSeconds = state.elapsedSeconds + dtSeconds;
	const shouldStop =
		nextElapsedSeconds >= params.maxDurationSeconds || nextBoids.length === 0;

	return {
		boids: nextBoids,
		predators: nextPredators,
		foodStock: nextFoodStock,
		cohesionSamples: nextCohesionSamples,
		elapsedSeconds: nextElapsedSeconds,
		lastTimestamp: timestamp,
		shouldStop,
	};
}
