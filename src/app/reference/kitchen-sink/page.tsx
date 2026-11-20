import { BackLink } from "~/components/back-link";
import { LabeledCard } from "~/components/labeled-card";

// Visual gate for the LabeledCard/BackLink styling shared by
// `~/app/reference/parameters/page.tsx`, `population-lifecycle/page.tsx`,
// `scoring/page.tsx`, and `storyline/page.tsx`. Renders both components in
// their real states side by side so each one is visible at once for a
// screenshot, instead of coaxing a real reference page into each state
// manually. This repo has no screenshot-testing tool installed and none is
// being added for this change — reviewing this page directly is the gate.
//
// classNames below are copied verbatim from the reference pages' own usage
// (not generic defaults) so this proves the actual styled components the
// real views render, not generic ones.
//
// Root element is a `<div>`, not `<main>` — `AppShell`'s `SidebarInset`
// already renders the page's one `<main>` landmark (see AGENTS.md's UI
// section).
//
// Unlike the dashboard/leaderboard/runs kitchen sinks, this view has no
// filter/row interactivity — the reference pages are static content, so
// LabeledCard and BackLink are the only components to prove here.
export default function ReferenceKitchenSinkPage() {
	return (
		<div className="from-primary to-background text-foreground flex min-h-screen flex-col items-center justify-center gap-8 bg-gradient-to-b p-8">
			<h1 className="text-3xl font-bold">Reference Kitchen Sink</h1>
			<div className="grid w-full max-w-2xl grid-cols-2 gap-6">
				<section className="col-span-2 flex flex-col gap-2">
					<h2 className="text-sm font-semibold">LabeledCard: default</h2>
					{/* Two-line shape — matches `population-lifecycle/page.tsx` and
					    `scoring/page.tsx`: a title plus a single description line. */}
					<LabeledCard title="Crash">
						<span className="text-foreground text-sm">
							The population is declining sharply alongside low food
							availability, driven by starvation and/or predation.
						</span>
					</LabeledCard>
				</section>

				<section className="col-span-2 flex flex-col gap-2">
					<h2 className="text-sm font-semibold">
						LabeledCard: with extra line
					</h2>
					{/* Three-line shape — matches `parameters/page.tsx`: a title, a
					    description line, and a muted range/default line below it. */}
					<LabeledCard title="Boid count">
						<span className="text-foreground text-sm">
							How many boids start the simulation.
						</span>
						<span className="text-muted-foreground text-xs">
							Range: 10–500 · Default: 120
						</span>
					</LabeledCard>
				</section>

				<section className="flex flex-col gap-2">
					<h2 className="text-sm font-semibold">BackLink: default</h2>
					<BackLink />
				</section>

				<section className="flex flex-col gap-2">
					<h2 className="text-sm font-semibold">BackLink: focus-visible</h2>
					{/* To trigger this state during review, Tab into the page until
					    focus lands on this link (or click elsewhere first, then press
					    Tab) — the ring should use the `--ring` token via
					    `focus-visible:ring-ring/50`, or be confirmed as a pre-existing
					    gap rather than a regression; `BackLink` carries no
					    `focus-visible` class of its own. */}
					<BackLink />
				</section>

				<section className="flex flex-col gap-2">
					<h2 className="text-sm font-semibold">BackLink: hover</h2>
					{/* Hover is a pointer-driven pseudo-class and can't be forced in a
					    static render. For the screenshot step, hover the pointer over
					    this link to capture its `hover:text-muted-foreground`. */}
					<BackLink />
				</section>

				<section className="col-span-2 flex flex-col gap-2">
					<h2 className="text-sm font-semibold">
						LabeledCard/BackLink: disabled, error, empty, loading (N/A)
					</h2>
					{/* N/A for these components: `parameters`, `population-lifecycle`,
					    `scoring`, and `storyline` are static content pages with no data
					    fetching and no interactive controls — there is no disabled,
					    error, empty, or loading state for LabeledCard or BackLink to
					    render. Marked explicitly per /10x-ui's Definition of Done,
					    matching the precedent set by the leaderboard/runs kitchen-sink
					    pages for states that don't apply, rather than fabricating one. */}
					<p className="text-foreground/70 text-sm">
						No disabled, error, empty, or loading state exists for LabeledCard
						or BackLink on these static reference pages.
					</p>
				</section>
			</div>
		</div>
	);
}
