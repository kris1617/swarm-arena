import Link from "next/link";

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
		description: "How genetically diverse the surviving population remained.",
	},
	{
		name: "Phase quality",
		description:
			"The quality of the population's lifecycle-phase history over the whole run — not just its end state.",
	},
];

export default function ScoringPage() {
	return (
		<div className="flex min-h-screen flex-col items-center gap-6 p-8">
			<div className="flex w-full max-w-2xl flex-col gap-4">
				<h1 className="text-3xl font-bold">Scoring</h1>

				<p className="text-foreground">
					Each simulation run is scored as the product of four factors:
				</p>

				<div className="flex flex-col gap-3">
					{FACTORS.map((factor) => (
						<div
							className="bg-input flex flex-col gap-1 rounded-2xl px-6 py-4"
							key={factor.name}
						>
							<span className="text-foreground font-semibold">
								{factor.name}
							</span>
							<span className="text-foreground text-sm">
								{factor.description}
							</span>
						</div>
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

				<p className="text-muted-foreground">
					When you&apos;ve run several variants, the score and its four-part
					breakdown are what let you say one configuration genuinely
					outperformed another, rather than guessing from watching the
					animation.
				</p>

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
