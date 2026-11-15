import Link from "next/link";

const TOPICS = [
	{
		href: "/reference/storyline",
		title: "Storyline",
		description: "What Swarm Arena is and why it exists.",
	},
	{
		href: "/reference/parameters",
		title: "Parameters",
		description: "Every configurable parameter and what it controls.",
	},
	{
		href: "/reference/population-lifecycle",
		title: "Population Lifecycle",
		description: "The five phases a population moves through during a run.",
	},
	{
		href: "/reference/scoring",
		title: "Scoring",
		description: "How a run's final score is calculated.",
	},
];

export default function ReferenceIndexPage() {
	return (
		<div className="flex min-h-screen flex-col items-center gap-8 p-8">
			<div className="flex flex-col items-center gap-2 text-center">
				<h1 className="text-3xl font-bold">Reference</h1>
				<p className="text-muted-foreground">
					Background on the simulation, separate from the app you use to run it.
				</p>
			</div>

			<div className="flex w-full max-w-2xl flex-col gap-3">
				{TOPICS.map((topic) => (
					<Link
						className="bg-input hover:bg-foreground/15 flex flex-col gap-1 rounded-2xl px-6 py-4 transition"
						href={topic.href}
						key={topic.href}
					>
						<span className="text-foreground font-semibold">{topic.title}</span>
						<span className="text-muted-foreground text-sm">
							{topic.description}
						</span>
					</Link>
				))}
			</div>
		</div>
	);
}
