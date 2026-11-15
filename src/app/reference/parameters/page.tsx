import Link from "next/link";
import { DEFAULT_PARAMETER_RANGES } from "~/server/simulation/parameter-ranges";

const PARAMETER_DESCRIPTIONS: Record<
	keyof typeof DEFAULT_PARAMETER_RANGES,
	string
> = {
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
	energyThreshold: "The energy level below which a boid dies of starvation.",
	mutationChance:
		"The probability that a newly bred boid's genes mutate from its parents'.",
	mutationMagnitude: "How large a gene mutation can be when one occurs.",
	xyArea: "The side length of the square area the simulation wraps within.",
	zDepth: "The depth of the volume the simulation wraps within.",
	// live-crossbreeding-toggle: has its own hand-written card below the loop
	// (a boolean has no min/max/default to describe here) — a placeholder
	// value keeps this Record exhaustive without being rendered anywhere,
	// since the loop below filters this key out.
	crossbreedingEnabled: "",
};

const PARAMETER_LABELS: Record<keyof typeof DEFAULT_PARAMETER_RANGES, string> =
	{
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
		energyThreshold: "Energy threshold",
		mutationChance: "Mutation chance",
		mutationMagnitude: "Mutation magnitude",
		xyArea: "Area size",
		zDepth: "Depth size",
		crossbreedingEnabled: "",
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
					{Object.entries(DEFAULT_PARAMETER_RANGES)
						.filter(([name]) => name !== "crossbreedingEnabled")
						.map(([name, range]) => {
							const key = name as keyof typeof DEFAULT_PARAMETER_RANGES;
							return (
								<div
									className="bg-input flex flex-col gap-1 rounded-2xl px-6 py-4"
									key={name}
								>
									<span className="text-foreground font-semibold">
										{PARAMETER_LABELS[key]}
									</span>
									<span className="text-foreground text-sm">
										{PARAMETER_DESCRIPTIONS[key]}
									</span>
									<span className="text-muted-foreground text-xs">
										Range: {range.min}–{range.max} · Default: {range.default}
									</span>
								</div>
							);
						})}

					<div className="bg-input flex flex-col gap-1 rounded-2xl px-6 py-4">
						<span className="text-foreground font-semibold">
							Crossbreeding enabled
						</span>
						<span className="text-foreground text-sm">
							Whether boids from different flocks can breed with each other. A
							boolean toggle, not a ranged numeric parameter.
						</span>
					</div>
				</div>

				<Link
					className="text-foreground hover:text-muted-foreground underline"
					href="/reference"
				>
					← Back to Reference
				</Link>
			</div>
		</div>
	);
}
