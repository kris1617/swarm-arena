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
					flockCount: DEFAULT_PARAMETER_RANGES.flockCount.default,
					crossbreedingEnabled,
					energyThreshold: DEFAULT_PARAMETER_RANGES.energyThreshold.default,
					mutationChance: DEFAULT_PARAMETER_RANGES.mutationChance.default,
					mutationMagnitude: DEFAULT_PARAMETER_RANGES.mutationMagnitude.default,
					xyArea: DEFAULT_PARAMETER_RANGES.xyArea.default,
					zDepth: DEFAULT_PARAMETER_RANGES.zDepth.default,
				});
			}
		}
	}

	return rows;
}
