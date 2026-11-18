// parameter-sweep-corpus-generation Phase 3: the concrete ~20-run parameter
// matrix the batched orchestrator (generate-sweep.ts) drives through the
// harness (Phase 1/2) to build the real corpus fixture (Phase 4).
//
// `separationWeight` x `foodRegenRate` x `crossbreedingEnabled` is a 4x3x2 =
// 24-cell full-factorial grid; 4 redundant corners are dropped to land on
// exactly 20 rows (see the DROPPED_CORNERS list below). Every other
// `StartCorpusRunParams` field stays pinned at its
// `DEFAULT_PARAMETER_RANGES` default — this sweep is about the
// separation/food-regen/crossbreeding interaction, not a full-dimensional
// grid search.
//
// per-tribe-predator-config Phase 2 (#6a): `crossbreedingEnabled` moved from
// a top-level `StartCorpusRunParams` scalar to a per-tribe `TribeConfig`
// field. The sweep axis is redesigned to sweep tribe 0's
// `crossbreedingEnabled` specifically — `flockCount` defaults to 2 (its
// admin-range floor), so every row already has a second tribe to gate
// against; tribe 0 carries the swept boolean while every other tribe
// (index 1+) stays pinned at `true` so a cross-tribe pair's gate outcome is
// driven entirely by tribe 0's own swept value, not a confound from the
// other tribe's flag also varying.
import { DEFAULT_PARAMETER_RANGES } from "~/server/simulation/parameter-ranges";
import type { StartCorpusRunParams } from "./harness";

export type SweepRunParams = StartCorpusRunParams & { sweepIndex: number };

const SEPARATION_WEIGHTS = [0.5, 1, 2, 4] as const;
const FOOD_REGEN_RATES = [2, 10, 30] as const;
const CROSSBREEDING_VALUES = [true, false] as const;

// The 4 corners of the full 4x3x2 grid dropped to reach exactly 20 rows —
// see this phase's plan for the rationale (these corners are redundant with
// the coverage the remaining 20 rows already give the sweep).
const DROPPED_CORNERS: ReadonlyArray<{
	separationWeight: number;
	foodRegenRate: number;
	crossbreedingEnabled: boolean;
}> = [
	{ separationWeight: 4, foodRegenRate: 30, crossbreedingEnabled: false },
	{ separationWeight: 0.5, foodRegenRate: 2, crossbreedingEnabled: false },
	{ separationWeight: 4, foodRegenRate: 2, crossbreedingEnabled: false },
	{ separationWeight: 0.5, foodRegenRate: 30, crossbreedingEnabled: false },
];

function isDroppedCorner(
	separationWeight: number,
	foodRegenRate: number,
	crossbreedingEnabled: boolean,
): boolean {
	return DROPPED_CORNERS.some(
		(corner) =>
			corner.separationWeight === separationWeight &&
			corner.foodRegenRate === foodRegenRate &&
			corner.crossbreedingEnabled === crossbreedingEnabled,
	);
}

// Builds the 20-row parameter-sweep matrix. Pure — no DB, no I/O. Every
// field not swept here (`boidCount`, `predatorCount`, `foodStockInitial`,
// `protectionThreshold`, `energyThreshold`, `mutationChance`,
// `mutationMagnitude`, `flockCount`, `xyArea`, `zDepth`, `alignmentWeight`,
// `cohesionWeight`) is pinned at its `DEFAULT_PARAMETER_RANGES` default;
// `maxDurationSeconds` is 3600 for every row (see plan).
export function buildSweepMatrix(): SweepRunParams[] {
	const rows: SweepRunParams[] = [];
	let sweepIndex = 0;

	for (const separationWeight of SEPARATION_WEIGHTS) {
		for (const foodRegenRate of FOOD_REGEN_RATES) {
			for (const crossbreedingEnabled of CROSSBREEDING_VALUES) {
				if (
					isDroppedCorner(separationWeight, foodRegenRate, crossbreedingEnabled)
				) {
					continue;
				}

				sweepIndex += 1;
				const flockCount = DEFAULT_PARAMETER_RANGES.flockCount.default;
				const predatorFlockCount =
					DEFAULT_PARAMETER_RANGES.predatorFlockCount.default;
				// per-tribe-behavior-weights Phase 1: type-only field this phase —
				// not yet read by any engine code. Uniform across tribes, mirroring
				// this row's own swept/pinned weights, so a tribeConfigs-aware
				// future reader sees the same values this sweep has always pinned
				// at the top level.
				// per-tribe-predator-config Phase 2 (#6a): `crossbreedingEnabled`
				// is intentionally NOT set here — it's assigned per-index below
				// (tribe 0 = this row's swept value, tribes 1+ = `true`), so this
				// base shape can't accidentally apply the swept value uniformly.
				const baseTribeConfig = {
					separation: separationWeight,
					alignment: DEFAULT_PARAMETER_RANGES.alignmentWeight.default,
					cohesion: DEFAULT_PARAMETER_RANGES.cohesionWeight.default,
					maxSpeed: 40,
					minSpeed: 15,
					matePreference: DEFAULT_PARAMETER_RANGES.matePreference.default,
					neighborRadius: DEFAULT_PARAMETER_RANGES.neighborRadius.default,
					separationRadius: DEFAULT_PARAMETER_RANGES.separationRadius.default,
					predatorDetectionRadius:
						DEFAULT_PARAMETER_RANGES.predatorDetectionRadius.default,
					burstMult: DEFAULT_PARAMETER_RANGES.burstMult.default,
					burstCostMult: DEFAULT_PARAMETER_RANGES.burstCostMult.default,
					foodStockShare: DEFAULT_PARAMETER_RANGES.foodStockShare.default,
					foodRegenShare: DEFAULT_PARAMETER_RANGES.foodRegenShare.default,
					foodConsumptionRate:
						DEFAULT_PARAMETER_RANGES.foodConsumptionRate.default,
				};
				// predator-tribe-concept Phase 1: type-only field this phase — not
				// yet read by any engine code. Pinned at its own defaults, same
				// posture as `baseTribeConfig` above — predators are not part of
				// this sweep's crossbreeding axis, so every predator tribe stays
				// pinned at `crossbreedingEnabled: true`.
				const predatorTribeConfig = {
					separation: DEFAULT_PARAMETER_RANGES.separationWeight.default,
					alignment: DEFAULT_PARAMETER_RANGES.alignmentWeight.default,
					cohesion: DEFAULT_PARAMETER_RANGES.cohesionWeight.default,
					maxSpeed: 40,
					minSpeed: 15,
					matePreference: DEFAULT_PARAMETER_RANGES.matePreference.default,
					detectionRadius: DEFAULT_PARAMETER_RANGES.detectionRadius.default,
					captureRadiusMult: DEFAULT_PARAMETER_RANGES.captureRadiusMult.default,
					crossbreedingEnabled: true,
					// second-predator-tribe-prey-target Phase 2: matches today's
					// actual behavior exactly (predators have never hunted
					// anything but boids); not part of this sweep's axes.
					preyTarget: "boids" as const,
				};
				rows.push({
					sweepIndex,
					boidCount: DEFAULT_PARAMETER_RANGES.boidCount.default,
					separationWeight,
					alignmentWeight: DEFAULT_PARAMETER_RANGES.alignmentWeight.default,
					cohesionWeight: DEFAULT_PARAMETER_RANGES.cohesionWeight.default,
					maxDurationSeconds: 3600,
					predatorCount: DEFAULT_PARAMETER_RANGES.predatorCount.default,
					protectionThreshold:
						DEFAULT_PARAMETER_RANGES.protectionThreshold.default,
					foodStockInitial: DEFAULT_PARAMETER_RANGES.foodStockInitial.default,
					foodRegenRate,
					flockCount,
					predatorFlockCount,
					predatorTribeConfigs: Array.from(
						{ length: predatorFlockCount },
						() => predatorTribeConfig,
					),
					energyThreshold: DEFAULT_PARAMETER_RANGES.energyThreshold.default,
					mutationChance: DEFAULT_PARAMETER_RANGES.mutationChance.default,
					mutationMagnitude: DEFAULT_PARAMETER_RANGES.mutationMagnitude.default,
					xyArea: DEFAULT_PARAMETER_RANGES.xyArea.default,
					zDepth: DEFAULT_PARAMETER_RANGES.zDepth.default,
					// per-tribe-predator-config Phase 2 (#6a): tribe 0 carries this
					// row's swept `crossbreedingEnabled` value; every other tribe
					// (index 1+) stays pinned at `true` — see this function's own
					// comment above for why.
					tribeConfigs: Array.from({ length: flockCount }, (_, index) => ({
						...baseTribeConfig,
						crossbreedingEnabled: index === 0 ? crossbreedingEnabled : true,
					})),
				});
			}
		}
	}

	return rows;
}
