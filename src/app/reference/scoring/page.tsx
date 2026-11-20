import Link from "next/link";
import { BackLink } from "~/components/back-link";
import { LabeledCard } from "~/components/labeled-card";

const FACTORS = [
	{
		name: "Survival duration",
		description: "How long the population survived over the run.",
	},
	{
		name: "Food management",
		description: "How efficiently the population managed available food.",
	},
	{
		name: "Genetic diversity",
		description:
			"How genetically diverse the surviving population remained. With multiple tribes, this number also reflects how separate the tribes' gene pools still are — enabling crossbreeding will tend to lower it over time as tribes blend, even if within-tribe variation hasn't changed.",
	},
	{
		name: "Phase quality",
		description:
			"The quality of the population's lifecycle-phase history over the whole run — not just its end state.",
	},
	{
		name: "Area population density",
		description:
			"How well-populated the simulation's configured area stayed relative to its size, averaged over the run.",
	},
];

export default function ScoringPage() {
	return (
		<div className="flex min-h-screen flex-col items-center gap-6 p-8">
			<div className="flex w-full max-w-2xl flex-col gap-4">
				<h1 className="text-3xl font-bold">Scoring</h1>

				<p className="text-foreground">
					Each simulation run is scored as the product of five factors:
				</p>

				<div className="flex flex-col gap-3">
					{FACTORS.map((factor) => (
						<LabeledCard key={factor.name} title={factor.name}>
							<span className="text-foreground text-sm">
								{factor.description}
							</span>
						</LabeledCard>
					))}
				</div>

				<p className="text-foreground">
					The phase-quality factor specifically rewards two things, combined: a
					time-weighted average of per-phase quality (so a run spending more of
					its duration in healthy phases — Growth, Recovery — scores higher than
					one spending most of it in Crash), and a resilience bonus for
					completing a Crash → Recovery transition — a run that crashes but
					genuinely bounces back scores better than one that either never
					crashes, or crashes and stays crashed. See{" "}
					<Link className="underline" href="/reference/population-lifecycle">
						Population Lifecycle
					</Link>{" "}
					for what each phase means.
				</p>

				<p className="text-foreground">
					Runs with more than one predator tribe also factor in how balanced the
					tribes&apos; populations stayed — scored as a neutral no-op for
					single-tribe runs, and not broken out as its own line in the
					comparison view above.
				</p>

				<p className="text-muted-foreground">
					When you&apos;ve run several variants, the score and its five-part
					breakdown are what let you say one configuration genuinely
					outperformed another, rather than guessing from watching the
					animation.
				</p>

				<BackLink />
			</div>
		</div>
	);
}
