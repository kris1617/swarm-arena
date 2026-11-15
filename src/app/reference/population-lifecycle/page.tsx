import Link from "next/link";

const PHASES = [
	{
		name: "Establishment",
		description:
			"Early ticks — the population is still small and hasn't shown a clear trend yet.",
	},
	{
		name: "Growth",
		description:
			"The population is rising: food availability is high and reproduction is outpacing deaths.",
	},
	{
		name: "Overshoot",
		description:
			"The population is elevated while food availability is dropping — the lag between resource depletion and the death-rate response catching up.",
	},
	{
		name: "Crash",
		description:
			"The population is declining sharply alongside low food availability, driven by starvation and/or predation.",
	},
	{
		name: "Recovery",
		description:
			"The population is stabilizing or growing again after a Crash, as food availability recovers.",
	},
];

export default function PopulationLifecyclePage() {
	return (
		<div className="flex min-h-screen flex-col items-center gap-6 p-8">
			<div className="flex w-full max-w-2xl flex-col gap-4">
				<h1 className="text-3xl font-bold">Population Lifecycle</h1>

				<p className="text-foreground">
					Every tick, the boid population's state is classified into one of five
					phases, using the boom-bust (irruptive-growth) model from population
					ecology — chosen because, unlike a simple logistic-growth curve, it
					has a crash phase, and this simulation's finite food supply plus
					starvation and predation can genuinely crash a population.
				</p>

				<p className="text-muted-foreground">
					Classification combines the population's recent trend (rising or
					falling over a short rolling window) with the food-availability ratio
					(current food stock relative to the configured initial stock) — not
					population size alone.
				</p>

				<div className="flex flex-col gap-3">
					{PHASES.map((phase) => (
						<div
							className="bg-input flex flex-col gap-1 rounded-2xl px-6 py-4"
							key={phase.name}
						>
							<span className="text-foreground font-semibold">
								{phase.name}
							</span>
							<span className="text-foreground text-sm">
								{phase.description}
							</span>
						</div>
					))}
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
