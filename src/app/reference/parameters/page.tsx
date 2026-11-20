import { BackLink } from "~/components/back-link";
import { LabeledCard } from "~/components/labeled-card";
import {
	DEFAULT_PARAMETER_RANGES,
	TOP_LEVEL_RANGED_PARAMETER_NAMES,
	type TopLevelRangedParameterName,
} from "~/server/simulation/parameter-ranges";

// per-tribe-behavior-weights Phase 1: this page documents the top-level
// `startInputSchema` scalar fields only. The six new per-tribe fields
// (`TRIBE_RANGED_FIELD_NAMES`) live inside each `tribeConfigs[]` entry, not
// as a single run-level scalar — documenting them belongs with Phase 8's
// tabbed per-tribe UI, not this generic reference page.
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

				<BackLink />
			</div>
		</div>
	);
}
