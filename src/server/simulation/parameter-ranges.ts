// S-04 (FR-002 full): the set of simulation parameters an admin can bound,
// and the default ranges seeded on first read — chosen to match today's
// pre-S-04 hardcoded zod bounds/UI defaults exactly, so nothing changes in
// practice until an admin edits them. `crossbreedingEnabled` is excluded —
// it's a boolean toggle, not a ranged numeric parameter.
export const RANGED_PARAMETER_NAMES = [
	"boidCount",
	"separationWeight",
	"alignmentWeight",
	"cohesionWeight",
	"maxDurationSeconds",
	"predatorCount",
	"protectionThreshold",
	"foodStockInitial",
	"foodRegenRate",
	"flockCount",
	"energyThreshold",
	"mutationChance",
	"mutationMagnitude",
] as const;

export type RangedParameterName = (typeof RANGED_PARAMETER_NAMES)[number];

export type ParameterRange = { min: number; max: number; default: number };

export type ParameterRanges = Record<RangedParameterName, ParameterRange>;

// Matches the pre-S-04 hardcoded zod bounds exactly where one existed
// (boidCount/predatorCount/protectionThreshold .max(500),
// maxDurationSeconds .max(600), flockCount [2,4], mutationChance/
// mutationMagnitude [0,1]). Where no hardcoded max existed before
// (weights, foodStockInitial, foodRegenRate, energyThreshold), picks a
// generous sane ceiling — this project's first admin-configurable default,
// not a replication of a prior bound that never existed.
export const DEFAULT_PARAMETER_RANGES: ParameterRanges = {
	boidCount: { min: 1, max: 500, default: 100 },
	separationWeight: { min: 0, max: 10, default: 1 },
	alignmentWeight: { min: 0, max: 10, default: 1 },
	cohesionWeight: { min: 0, max: 10, default: 1 },
	maxDurationSeconds: { min: 1, max: 600, default: 30 },
	predatorCount: { min: 0, max: 500, default: 5 },
	protectionThreshold: { min: 0, max: 500, default: 10 },
	foodStockInitial: { min: 0.1, max: 10_000, default: 100 },
	foodRegenRate: { min: 0, max: 1_000, default: 10 },
	flockCount: { min: 2, max: 4, default: 2 },
	energyThreshold: { min: 0.1, max: 500, default: 50 },
	mutationChance: { min: 0, max: 1, default: 0.1 },
	mutationMagnitude: { min: 0, max: 1, default: 0.2 },
};

export const DEFAULT_MAX_OBJECT_COUNT = 500;

// F-07: caps the SUM of boidCount+predatorCount across every one of a
// user's currently-ticking server-owned runs at once — distinct from
// DEFAULT_MAX_OBJECT_COUNT, which only bounds a single run.
// Measured, not guessed: this engine's tick time crosses the 16ms
// real-time budget around 200 combined individuals on this project's VPS
// (single-threaded JS tick execution — 4 vCPUs don't parallelize it). 150
// leaves margin below that measured breakeven point. See
// context/foundation/capacity-limits.md.
export const DEFAULT_MAX_CONCURRENT_OBJECT_COUNT = 150;
