import {
	type BoidState,
	classifyPopulationPhase,
	computeCohesion,
	computeGeneticDiversity,
	PHASE_WINDOW_SIZE,
	type PopulationPhase,
	type PredatorState,
	runTick,
	type WorldSize,
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
		// S-04 (FR-010 full, FR-019): threaded once here so both the
		// client-staged and server-owned paths (which both call this one
		// shared function) get resource-management/phase-classifier
		// tracking automatically, with no duplicated logic.
		foodRatioSamples: number[];
		populationCountSamples: number[];
		// S-25 (FR-010 full, FR-035): raw per-tick density samples (combined
		// boid+predator population ÷ full 3D volume) — threaded through the
		// same shared tick core as the other sample arrays so both execution
		// paths collect it identically.
		populationDensitySamples: number[];
		// genetic-diversity-trend Phase 1: one computed value per tick,
		// threaded through the same shared tick core as the other sample
		// arrays so both execution paths collect it identically.
		geneticDiversitySamples: number[];
		phaseHistory: PopulationPhase[];
		elapsedSeconds: number;
		lastTimestamp: number | null;
		// spatial-grid-dense-clustering-fallback Phase 3: persisted across
		// ticks the same way lastTimestamp/populationCapped are — once a run
		// has ever tripped runTick's dense-clustering warn-sink, later ticks
		// must not log the warning again for that same run.
		hasWarnedDenseClustering: boolean;
	},
	timestamp: number,
	params: {
		foodRegenRate: number;
		protectionThreshold: number;
		maxDurationSeconds: number;
		foodStockInitial: number;
		// Owned and persisted across ticks by the caller (simulation-canvas.tsx,
		// via a ref created once per run) — this function has no way to persist
		// state between calls itself, so creating a fresh rng here would make
		// reproduction's mutation/gender rolls non-deterministic across ticks.
		rng: () => number;
		crossbreedingEnabled: boolean;
		energyThreshold: number;
		mutationChance: number;
		mutationMagnitude: number;
		// S-24: the run's own configured spatial extent, threaded straight
		// into runTick/computeCohesion below instead of their old hardcoded
		// 200-unit assumption.
		worldSize: WorldSize;
		// unwatched-run-tick-throttling Phase 2: scales the computed
		// dtSeconds before the MAX_DT_SECONDS clamp, applied by the caller
		// (server-run-registry.ts's tick()) when a run has had zero watchers
		// for the grace period — the real-time TICK_INTERVAL_MS scheduler
		// cadence is untouched, only the simulated-time delta changes.
		// Defaults to 1 (no scaling) so every existing caller/test is
		// unaffected.
		speedMultiplier?: number;
	},
): {
	boids: BoidState[];
	predators: PredatorState[];
	foodStock: number;
	cohesionSamples: number[];
	foodRatioSamples: number[];
	populationCountSamples: number[];
	populationDensitySamples: number[];
	geneticDiversitySamples: number[];
	phaseHistory: PopulationPhase[];
	elapsedSeconds: number;
	lastTimestamp: number;
	shouldStop: boolean;
	// Forwarded directly from this tick's runTick result (boidsCapped ||
	// predatorsCapped) — Phase 4's UI indicator reads this, not runTick
	// itself, so the canvas/RAF shell never needs to reach past this
	// decision core.
	populationCapped: boolean;
	// spatial-grid-dense-clustering-fallback Phase 3: persisted sticky flag —
	// once true for a run, stays true for every later tick of that run.
	hasWarnedDenseClustering: boolean;
	// unwatched-run-tick-throttling Phase 2: true iff this tick actually
	// applied a >1 speedMultiplier — distinct from the caller's grace-period
	// decision, since the caller needs to know the multiplier was genuinely
	// applied (not merely that the grace period elapsed) before persisting
	// the sticky wasEverThrottled marker.
	wasThrottledThisTick: boolean;
} {
	// A fresh first call has no prior frame to diff against, so treat it as
	// dtSeconds = 0 rather than applying a huge dt derived from an absolute
	// epoch timestamp — matches the component's prior
	// `if (lastTimestampRef.current === null) lastTimestampRef.current = timestamp;`.
	const previousTimestamp =
		state.lastTimestamp === null ? timestamp : state.lastTimestamp;
	const speedMultiplier = params.speedMultiplier ?? 1;
	const dtSeconds = Math.min(
		((timestamp - previousTimestamp) / 1000) * speedMultiplier,
		MAX_DT_SECONDS,
	);
	const wasThrottledThisTick = speedMultiplier > 1;

	const {
		boids: nextBoids,
		predators: nextPredators,
		foodStock: nextFoodStock,
		populationCapped,
		foodAvailabilityRatio,
		hasWarnedDenseClustering: tickHasWarnedDenseClustering,
	} = runTick(
		{
			boids: state.boids,
			predators: state.predators,
			foodStock: state.foodStock,
		},
		{
			dtSeconds,
			foodRegenRate: params.foodRegenRate,
			protectionThreshold: params.protectionThreshold,
			rng: params.rng,
			crossbreedingEnabled: params.crossbreedingEnabled,
			energyThreshold: params.energyThreshold,
			mutationChance: params.mutationChance,
			mutationMagnitude: params.mutationMagnitude,
			populationCap: 500,
			foodStockInitial: params.foodStockInitial,
			worldSize: params.worldSize,
		},
	);

	// Mutate-in-place growth: these six arrays are never read for referential
	// identity/immutability by either consumer (simulation-canvas.tsx's refs,
	// server-run-registry.ts's reassigned `run` object), so pushing onto the
	// caller-owned array and returning that same reference turns per-tick
	// cost from O(current length) (full-array-copy rebuild) to O(1)
	// amortized. Safe per the plan's snapshot/resume re-check: snapshotServerRun
	// clears the run's interval before handing back these references (no
	// further mutation can occur afterward), and resumeServerRun only ever
	// receives a freshly-deserialized DB snapshot, never a live reference.
	const nextCohesionSamples = state.cohesionSamples;
	nextCohesionSamples.push(computeCohesion(nextBoids, params.worldSize));
	const nextFoodRatioSamples = state.foodRatioSamples;
	nextFoodRatioSamples.push(foodAvailabilityRatio);
	const nextPopulationCountSamples = state.populationCountSamples;
	nextPopulationCountSamples.push(nextBoids.length);
	// S-25 (FR-010 full, FR-035): one raw density sample per tick — combined
	// boid+predator population ÷ the run's full configured 3D volume.
	// Normalization against the run's own first sample happens once, inside
	// computeAreaPopulationDensity, not at every collection site here.
	const volume = params.worldSize.x * params.worldSize.y * params.worldSize.z;
	const rawDensity =
		volume > 0 ? (nextBoids.length + nextPredators.length) / volume : 0;
	const nextPopulationDensitySamples = state.populationDensitySamples;
	nextPopulationDensitySamples.push(rawDensity);
	// genetic-diversity-trend Phase 1: one per-tick sample, computed from the
	// tick's resulting boid population's genes — same `nextBoids` array the
	// other per-tick computations above already read.
	const nextGeneticDiversitySamples = state.geneticDiversitySamples;
	nextGeneticDiversitySamples.push(
		computeGeneticDiversity(nextBoids.map((b) => b.genes)),
	);
	// classifyPopulationPhase only ever reads its last PHASE_WINDOW_SIZE
	// entries internally (boids.ts's own `history.slice(-PHASE_WINDOW_SIZE)`),
	// so building phaseHistoryWindow from the full history here was pure
	// per-tick waste once the arrays grow long. Each tick takes a fresh
	// slice (never cached across ticks) since nextPopulationCountSamples/
	// nextFoodRatioSamples are now the same mutated array object tick over
	// tick — `.slice` itself always returns a new array, so this stays
	// correct as long as it's taken fresh here, which it is.
	const windowedPopulationCountSamples = nextPopulationCountSamples.slice(
		-PHASE_WINDOW_SIZE,
	);
	const windowedFoodRatioSamples = nextFoodRatioSamples.slice(
		-PHASE_WINDOW_SIZE,
	);
	const phaseHistoryWindow = windowedPopulationCountSamples.map(
		(populationCount, index) => ({
			populationCount,
			foodAvailabilityRatio:
				windowedFoodRatioSamples[index] ?? foodAvailabilityRatio,
		}),
	);
	const nextPhase = classifyPopulationPhase(
		phaseHistoryWindow,
		state.phaseHistory.at(-1) ?? null,
	);
	const nextPhaseHistory = state.phaseHistory;
	nextPhaseHistory.push(nextPhase);

	const nextElapsedSeconds = state.elapsedSeconds + dtSeconds;
	const shouldStop =
		nextElapsedSeconds >= params.maxDurationSeconds || nextBoids.length === 0;

	// spatial-grid-dense-clustering-fallback Phase 3: log once, the first
	// tick this run ever trips runTick's warn-sink — never again afterward,
	// regardless of whether later ticks keep tripping it.
	if (tickHasWarnedDenseClustering && !state.hasWarnedDenseClustering) {
		console.warn("dense clustering truncated a spatial-grid query this tick");
	}
	const nextHasWarnedDenseClustering =
		state.hasWarnedDenseClustering || tickHasWarnedDenseClustering;

	return {
		boids: nextBoids,
		predators: nextPredators,
		foodStock: nextFoodStock,
		cohesionSamples: nextCohesionSamples,
		foodRatioSamples: nextFoodRatioSamples,
		populationCountSamples: nextPopulationCountSamples,
		populationDensitySamples: nextPopulationDensitySamples,
		geneticDiversitySamples: nextGeneticDiversitySamples,
		phaseHistory: nextPhaseHistory,
		elapsedSeconds: nextElapsedSeconds,
		lastTimestamp: timestamp,
		shouldStop,
		populationCapped,
		hasWarnedDenseClustering: nextHasWarnedDenseClustering,
		wasThrottledThisTick,
	};
}
