// S-04 (FR-002 full): the set of simulation parameters an admin can bound,
// and the default ranges seeded on first read — chosen to match today's
// pre-S-04 hardcoded zod bounds/UI defaults exactly, so nothing changes in
// practice until an admin edits them.
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
	"crossbreedingEnabled",
	"energyThreshold",
	"mutationChance",
	"mutationMagnitude",
	// S-24: the simulation's spatial extent — xyArea covers both x and y,
	// zDepth covers z. Admin-ranged like every other parameter here.
	"xyArea",
	"zDepth",
	// per-tribe-behavior-weights Phase 1: one shared range for all tribes
	// (decided) bounding each new `TribeConfig` field — see
	// `checkAgainstAdminRanges`'s nested per-tribe loop in simulation.ts.
	"neighborRadius",
	"separationRadius",
	"predatorDetectionRadius",
	"burstMult",
	"burstCostMult",
	"matePreference",
	// per-tribe-food-config Phase 1: one shared range for all tribes
	// (decided, same posture as the per-tribe-behavior-weights fields above)
	// bounding each new `TribeConfig` food field.
	"foodStockShare",
	"foodRegenShare",
	"foodConsumptionRate",
] as const;

export type RangedParameterName = (typeof RANGED_PARAMETER_NAMES)[number];

// per-tribe-behavior-weights Phase 1: the six RANGED_PARAMETER_NAMES that
// exist only inside each `TribeConfig` entry (`simulation.ts`'s
// `startInputSchema.tribeConfigs`), never as a top-level `startInputSchema`
// field — gate-fix after Phase 1's own typecheck sweep found every other
// consumer of `RangedParameterName` (parameter-suggestion.ts's
// `SuggestionInputRow`, the reference/parameters page) assumed the type was
// exactly the set of top-level fields, which stopped being true the moment
// these six were added to `RANGED_PARAMETER_NAMES` above.
export const TRIBE_RANGED_FIELD_NAMES = [
	"neighborRadius",
	"separationRadius",
	"predatorDetectionRadius",
	"burstMult",
	"burstCostMult",
	"matePreference",
	"foodStockShare",
	"foodRegenShare",
	"foodConsumptionRate",
] as const satisfies readonly RangedParameterName[];

export type TribeRangedFieldName = (typeof TRIBE_RANGED_FIELD_NAMES)[number];

// Every RANGED_PARAMETER_NAMES entry EXCEPT the six above — i.e. the names
// that genuinely are top-level `startInputSchema` fields, the set every
// pre-existing consumer of `RangedParameterName` actually assumed.
export const TOP_LEVEL_RANGED_PARAMETER_NAMES = RANGED_PARAMETER_NAMES.filter(
	(name) => !TRIBE_RANGED_FIELD_NAMES.includes(name as TribeRangedFieldName),
) as Exclude<RangedParameterName, TribeRangedFieldName>[];

export type TopLevelRangedParameterName =
	(typeof TOP_LEVEL_RANGED_PARAMETER_NAMES)[number];

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
	// live-crossbreeding-toggle: degenerate 0-1 range — a boolean toggle
	// admitted into the numeric admin-range machinery rather than branched
	// around it. Default of 1 matches the staging form's own default
	// (page.tsx, useState(true)). This entry is structurally inert: it is
	// filtered out of the admin settings UI (admin-settings-form.tsx) and
	// always skipped by checkAgainstAdminRanges's boolean short-circuit
	// (simulation.ts), so it can only be changed via a raw
	// updateParameterRanges API call, and even then has no observable effect.
	crossbreedingEnabled: { min: 0, max: 1, default: 1 },
	energyThreshold: { min: 0.1, max: 500, default: 50 },
	mutationChance: { min: 0, max: 1, default: 0.1 },
	mutationMagnitude: { min: 0, max: 1, default: 0.2 },
	// S-24: min/default of 200 preserves today's exact behavior unless an
	// admin explicitly raises it. Max of 1000 is grounded in this change's
	// own direct measurement that a larger area LOWERS tick cost at this
	// engine's fixed NEIGHBOR_RADIUS (confirmed at 400, direction holds at
	// 1000) — see context/foundation/capacity-limits.md.
	xyArea: { min: 200, max: 1000, default: 200 },
	zDepth: { min: 200, max: 1000, default: 200 },
	// per-tribe-behavior-weights Phase 1: defaults match today's fixed engine
	// constants in boids.ts (NEIGHBOR_RADIUS/SEPARATION_RADIUS/
	// PREDATOR_DETECTION_RADIUS) so a tribe left at default behaves
	// identically to pre-change behavior. Max bounded by half the largest
	// configurable world dimension (xyArea/zDepth's own max of 1000),
	// generous ceiling like every other previously-unranged field above.
	neighborRadius: { min: 1, max: 500, default: 70 },
	separationRadius: { min: 1, max: 500, default: 25 },
	predatorDetectionRadius: { min: 1, max: 500, default: 50 },
	// No prior fixed-constant precedent for burstMult/burstCostMult (burst
	// itself arrives in a later phase) — 1 means "no burst effect"/"no extra
	// cost" so a tribe left at default is unaffected, same generous 0-10
	// ceiling as the weight fields above.
	burstMult: { min: 0, max: 10, default: 1 },
	burstCostMult: { min: 0, max: 10, default: 1 },
	// matePreference's existing per-boid gene (BoidGenes.matePreference,
	// boids.ts) is seeded uniformly in [0,1) at spawn and blended
	// (unclamped) at reproduction — 0.5 (the seed range's midpoint) is the
	// default consistent with that scale; [0,1] bounds the per-tribe
	// starting value to the same range new boids are seeded within.
	matePreference: { min: 0, max: 1, default: 0.5 },
	// per-tribe-food-config Phase 1: defaults chosen so `flockCount` tribes
	// (default 2) each left at default reproduce today's exact pre-change
	// scalar behavior once a later phase wires these into the engine's food
	// math: foodStockShare's default (50) * 2 = foodStockInitial's own
	// default (100); foodRegenShare's default (5) * 2 = foodRegenRate's own
	// default (10); foodConsumptionRate's default (0.5) matches the
	// engine's existing fixed FOOD_CONSUMPTION_PER_BOID constant exactly
	// (boids.ts) — per-boid, so it doesn't scale with flockCount the way
	// the two per-tribe share fields do.
	foodStockShare: { min: 0, max: 10_000, default: 50 },
	foodRegenShare: { min: 0, max: 1_000, default: 5 },
	foodConsumptionRate: { min: 0, max: 10, default: 0.5 },
};

export const DEFAULT_MAX_OBJECT_COUNT = 500;

// live-parameter-adjustment (S-27): a soft (non-throwing) counterpart to
// `checkAgainstAdminRanges` in simulation.ts — a live edit may exceed the
// admin-configured range; it still applies, just with a warning per
// out-of-range field instead of a rejection. Relocated here (rather than
// kept server-router-local) so a client component can call the identical
// range comparison without pulling in server-only dependencies —
// client-staged-live-parameter-parity.
export function checkLiveParamRangesSoft(
	patch: Partial<Record<RangedParameterName, number>>,
	ranges: ParameterRanges,
): string[] {
	const warnings: string[] = [];
	for (const [field, value] of Object.entries(patch) as [
		RangedParameterName,
		number,
	][]) {
		const range = ranges[field];
		if (value < range.min || value > range.max) {
			warnings.push(
				`${field} (${value}) is outside the configured range ${range.min}-${range.max}`,
			);
		}
	}
	return warnings;
}

// F-07: caps the SUM of boidCount+predatorCount across every one of a
// user's currently-ticking server-owned runs at once — distinct from
// DEFAULT_MAX_OBJECT_COUNT, which only bounds a single run.
// Measured, not guessed: this engine's tick time crosses the 16ms
// real-time budget around 200 combined individuals on this project's VPS
// (single-threaded JS tick execution — 4 vCPUs don't parallelize it). 150
// leaves margin below that measured breakeven point. See
// context/foundation/capacity-limits.md.
export const DEFAULT_MAX_CONCURRENT_OBJECT_COUNT = 150;
