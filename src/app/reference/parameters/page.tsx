import { BackLink } from "~/components/back-link";
import { LabeledCard } from "~/components/labeled-card";
import {
	DEFAULT_PARAMETER_RANGES,
	PREDATOR_TRIBE_RANGED_FIELD_NAMES,
	type PredatorTribeRangedFieldName,
	TOP_LEVEL_RANGED_PARAMETER_NAMES,
	type TopLevelRangedParameterName,
	TRIBE_RANGED_FIELD_NAMES,
	type TribeRangedFieldName,
} from "~/server/simulation/parameter-ranges";

const PARAMETER_DESCRIPTIONS: Record<TopLevelRangedParameterName, string> = {
	boidCount: "How many boids start the simulation.",
	separationWeight:
		"How strongly boids steer away from nearby flockmates to avoid crowding.",
	alignmentWeight:
		"How strongly boids steer to match the average heading of nearby flockmates.",
	cohesionWeight:
		"How strongly boids steer toward the average position of nearby flockmates.",
	maxDurationSeconds:
		"The longest a run is allowed to continue before it stops automatically.",
	predatorCount: "How many predators start the simulation.",
	protectionThreshold:
		"The flock size below which boids become protected from predator attack.",
	foodStockInitial:
		"How much food is available in the environment at the start of a run.",
	foodRegenRate: "How quickly consumed food is replenished over time.",
	flockCount: "How many separate flocks the boid population is divided into.",
	// predator-tribe-concept Phase 1: predators' own, fully independent
	// tribe-count field — documents the same way `flockCount` does above.
	// The two new per-predator-tribe fields (`PREDATOR_TRIBE_RANGED_FIELD_NAMES`)
	// live inside each `predatorTribeConfigs[]` entry, not as a run-level
	// scalar, same posture as `TRIBE_RANGED_FIELD_NAMES`'s own fields above.
	predatorFlockCount:
		"How many separate tribes the predator population is divided into.",
	energyThreshold: "The energy level below which a boid dies of starvation.",
	mutationChance:
		"The probability that a newly bred boid's genes mutate from its parents'.",
	mutationMagnitude: "How large a gene mutation can be when one occurs.",
	xyArea: "The side length of the square area the simulation wraps within.",
	zDepth: "The depth of the volume the simulation wraps within.",
};

const PARAMETER_LABELS: Record<TopLevelRangedParameterName, string> = {
	boidCount: "Boid count",
	separationWeight: "Separation weight",
	alignmentWeight: "Alignment weight",
	cohesionWeight: "Cohesion weight",
	maxDurationSeconds: "Max duration (seconds)",
	predatorCount: "Predator count",
	protectionThreshold: "Protection threshold",
	foodStockInitial: "Initial food stock",
	foodRegenRate: "Food regen rate",
	flockCount: "Flock count",
	predatorFlockCount: "Predator flock count",
	energyThreshold: "Energy threshold",
	mutationChance: "Mutation chance",
	mutationMagnitude: "Mutation magnitude",
	xyArea: "Area size",
	zDepth: "Depth size",
};

const TRIBE_PARAMETER_DESCRIPTIONS: Record<TribeRangedFieldName, string> = {
	neighborRadius:
		"How far a boid looks to count others as flockmates for alignment and cohesion.",
	separationRadius:
		"How close another flockmate has to be before a boid steers away to avoid crowding.",
	predatorDetectionRadius:
		"How far a boid can notice a nearby predator and react to it.",
	burstMult:
		"How much faster a boid moves while bursting away from a detected predator.",
	burstCostMult:
		"How much extra energy a boid spends per tick while bursting, on top of normal movement cost.",
	matePreference:
		"How close in color another boid must be for this tribe's boids to accept it as a mate.",
	foodStockShare:
		"This tribe's share of the food pool available at the start of a run.",
	foodRegenShare:
		"This tribe's share of how quickly consumed food is replenished.",
	foodConsumptionRate:
		"How much food one boid in this tribe consumes per tick.",
};

const TRIBE_PARAMETER_LABELS: Record<TribeRangedFieldName, string> = {
	neighborRadius: "Neighbor radius",
	separationRadius: "Separation radius",
	predatorDetectionRadius: "Predator detection radius",
	burstMult: "Burst speed multiplier",
	burstCostMult: "Burst energy cost multiplier",
	matePreference: "Mate preference",
	foodStockShare: "Food stock share",
	foodRegenShare: "Food regen share",
	foodConsumptionRate: "Food consumption rate",
};

const PREDATOR_TRIBE_PARAMETER_DESCRIPTIONS: Record<
	PredatorTribeRangedFieldName,
	string
> = {
	detectionRadius: "How far a predator tribe scans to find prey.",
	captureRadiusMult:
		"How much this tribe's effective capture range is scaled relative to the simulation's base capture radius.",
	matePreference:
		"How close in color another predator must be for this tribe to accept it as a mate.",
	maxSpeed: "The fastest this tribe's predators can move.",
	minSpeed: "The slowest this tribe's predators can move.",
};

const PREDATOR_TRIBE_PARAMETER_LABELS: Record<
	PredatorTribeRangedFieldName,
	string
> = {
	detectionRadius: "Detection radius",
	captureRadiusMult: "Capture radius multiplier",
	matePreference: "Mate preference",
	maxSpeed: "Max speed",
	minSpeed: "Min speed",
};

export default function ParametersPage() {
	return (
		<div className="flex min-h-screen flex-col items-center gap-6 p-8">
			<div className="flex w-full max-w-2xl flex-col gap-4">
				<h1 className="text-3xl font-bold">Parameters</h1>

				<p className="text-muted-foreground">
					Every parameter below is bounded by an admin-configured range; a
					member picks a value within that range when starting a run. Default
					values shown here are the ship-time defaults, not necessarily the live
					admin settings for this deployment.
				</p>

				<div className="flex flex-col gap-3">
					{TOP_LEVEL_RANGED_PARAMETER_NAMES.map((name) => {
						const key = name;
						const range = DEFAULT_PARAMETER_RANGES[key];
						return (
							<LabeledCard key={name} title={PARAMETER_LABELS[key]}>
								<span className="text-foreground text-sm">
									{PARAMETER_DESCRIPTIONS[key]}
								</span>
								<span className="text-muted-foreground text-xs">
									Range: {range.min}–{range.max} · Default: {range.default}
								</span>
							</LabeledCard>
						);
					})}
				</div>

				<h2 className="text-2xl font-bold">Per-tribe boid parameters</h2>

				<div className="flex flex-col gap-3">
					{TRIBE_RANGED_FIELD_NAMES.map((name) => {
						const key = name;
						const range = DEFAULT_PARAMETER_RANGES[key];
						return (
							<LabeledCard key={name} title={TRIBE_PARAMETER_LABELS[key]}>
								<span className="text-foreground text-sm">
									{TRIBE_PARAMETER_DESCRIPTIONS[key]}
								</span>
								<span className="text-muted-foreground text-xs">
									Range: {range.min}–{range.max} · Default: {range.default}
								</span>
							</LabeledCard>
						);
					})}
				</div>

				<h2 className="text-2xl font-bold">Per-tribe predator parameters</h2>

				<div className="flex flex-col gap-3">
					{PREDATOR_TRIBE_RANGED_FIELD_NAMES.map((name) => {
						const key = name;
						const range = DEFAULT_PARAMETER_RANGES[key];
						return (
							<LabeledCard
								key={name}
								title={PREDATOR_TRIBE_PARAMETER_LABELS[key]}
							>
								<span className="text-foreground text-sm">
									{PREDATOR_TRIBE_PARAMETER_DESCRIPTIONS[key]}
								</span>
								<span className="text-muted-foreground text-xs">
									Range: {range.min}–{range.max} · Default: {range.default}
								</span>
							</LabeledCard>
						);
					})}
				</div>

				<h2 className="text-2xl font-bold">Per-tribe toggles</h2>

				<div className="flex flex-col gap-3">
					<LabeledCard title="Crossbreeding">
						<span className="text-foreground text-sm">
							Whether this tribe's boids (or predator tribe) can mate with
							members of a different tribe. When enabled for both tribes
							involved, the offspring's genes (including color) are a blend of
							both parents'.
						</span>
					</LabeledCard>
					<LabeledCard title="Prey target">
						<span className="text-foreground text-sm">
							Which populations a predator tribe hunts: boids only, or boids and
							the boids/predators of other predator tribes. A tribe never hunts
							its own members.
						</span>
					</LabeledCard>
				</div>

				<BackLink />
			</div>
		</div>
	);
}
