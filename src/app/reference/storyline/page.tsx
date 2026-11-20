import { BackLink } from "~/components/back-link";

export default function StorylinePage() {
	return (
		<div className="flex min-h-screen flex-col items-center gap-6 p-8">
			<div className="flex w-full max-w-2xl flex-col gap-4">
				<h1 className="text-3xl font-bold">Storyline</h1>

				<p className="text-foreground">
					Swarm Arena exists for a hobbyist experimenting with boids and
					predator-prey dynamics who has no tool that lets them configure a
					simulation, score the outcome against explicit evaluation criteria,
					and compare variants side by side.
				</p>

				<p className="text-foreground">
					Outside this app, trying a new parameter combination usually means
					manually editing code or config and restarting from scratch, with no
					quantified way to tell whether a change actually helped — too many
					parameters to tune by feel, and no persisted record of what was tried.
				</p>

				<p className="text-foreground">
					Existing boids simulators tend to stop at visualization: they show you
					the flocking behavior but don&apos;t score results or suggest
					parameter changes. Swarm Arena closes that gap by turning
					trial-and-error tuning into a measurable, resumable experimentation
					loop — you configure a run, watch it play out, and get back an
					objective score you can compare against your other attempts.
				</p>

				<p className="text-muted-foreground">
					The intended user is the builder themselves: someone who already knows
					the swarm mechanics they want to explore, running simulations
					repeatedly, tweaking parameters between runs, trying to find
					configurations that produce &quot;better&quot; flocking and evasion
					behavior.
				</p>

				<BackLink />
			</div>
		</div>
	);
}
