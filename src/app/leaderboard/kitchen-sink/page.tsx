"use client";

import Link from "next/link";
import { RunRow } from "~/components/run-row";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";

// Visual gate for the RunRow/Button styling used by `~/app/leaderboard/page.tsx`.
// Renders all 7 states from /10x-ui's Definition of Done side by side so each
// one is visible at once for a screenshot, instead of coaxing the real view
// into each state manually. This repo has no screenshot-testing tool
// installed and none is being added for this change — reviewing this page
// directly is the gate.
//
// classNames below are copied verbatim from `page.tsx`'s RunRow/Button usage
// (not generic defaults) so this proves the actual styled components the
// real view renders, not generic ones.
//
// Root element is a `<div>`, not `<main>` — `AppShell`'s `SidebarInset`
// already renders the page's one `<main>` landmark (see AGENTS.md's UI
// section).
//
// Duplicated below rather than imported: `statusCardClassName` in
// `leaderboard/page.tsx` is a local (non-exported) const, and this change
// does not touch `leaderboard/page.tsx` in Phase 2 — keep this string in
// sync with that file's `statusCardClassName` by hand.
const statusCardClassName =
	"bg-input text-foreground flex w-full max-w-md flex-col items-center gap-3 rounded-2xl px-6 py-8 text-center";

export default function LeaderboardKitchenSinkPage() {
	return (
		<div className="from-primary to-background text-foreground flex min-h-screen flex-col items-center justify-center gap-8 bg-gradient-to-b p-8">
			<h1 className="text-3xl font-bold">Leaderboard Kitchen Sink</h1>
			<div className="grid w-full max-w-2xl grid-cols-2 gap-6">
				<section className="col-span-2 flex flex-col gap-2">
					<h2 className="text-sm font-semibold">RunRow: default</h2>
					<div className="bg-input text-foreground flex flex-col gap-2 rounded-2xl px-4 py-3">
						<RunRow
							actionHref="/runs/1"
							actionLabel="View analysis"
							label={
								<span>Run #1 — 120 boids, 4 predators — started just now</span>
							}
							leading={<span className="font-semibold">#4</span>}
							trailing={<span className="font-semibold">Score: 12.34</span>}
						/>
					</div>
				</section>

				<section className="col-span-2 flex flex-col gap-2">
					<h2 className="text-sm font-semibold">RunRow: hover</h2>
					{/* Hover is a pointer-driven pseudo-class and can't be forced in a
					    static render. For the screenshot step, hover the pointer over
					    this row's "View analysis" button to capture its
					    `hover:bg-foreground/15`. */}
					<div className="bg-input text-foreground flex flex-col gap-2 rounded-2xl px-4 py-3">
						<RunRow
							actionHref="/runs/2"
							actionLabel="View analysis"
							label={
								<span>Run #2 — 120 boids, 4 predators — started just now</span>
							}
							leading={<span className="font-semibold">#5</span>}
							trailing={<span className="font-semibold">Score: 9.87</span>}
						/>
					</div>
				</section>

				<section className="col-span-2 flex flex-col gap-2">
					<h2 className="text-sm font-semibold">
						RunRow: className variant (top-3 border)
					</h2>
					{/* Side-by-side comparison confirms the `className` override
					    (`border-primary border-2`) composes with RunRow's base classes
					    instead of replacing them. */}
					<div className="bg-input text-foreground flex flex-col gap-2 rounded-2xl px-4 py-3">
						<RunRow
							actionHref="/runs/3"
							actionLabel="View analysis"
							className="border-primary border-2"
							label={
								<span>Run #3 — 120 boids, 4 predators — started just now</span>
							}
							leading={<span className="font-semibold">#1</span>}
							trailing={<span className="font-semibold">Score: 42.00</span>}
						/>
						<RunRow
							actionHref="/runs/4"
							actionLabel="View analysis"
							label={
								<span>Run #4 — 120 boids, 4 predators — started just now</span>
							}
							leading={<span className="font-semibold">#4</span>}
							trailing={<span className="font-semibold">Score: 12.34</span>}
						/>
					</div>
				</section>

				<section className="col-span-2 flex flex-col gap-2">
					<h2 className="text-sm font-semibold">Button: focus-visible</h2>
					{/* Leaderboard has no Tabs of its own — its only focusable control
					    is RunRow's "View analysis" action Button. To trigger this state
					    during review, Tab into the page until focus lands on this
					    button (or click elsewhere first, then press Tab) — the ring
					    should use the `--ring` token via `focus-visible:ring-ring/50`,
					    not a browser default outline. */}
					<Button
						asChild
						className="hover:bg-foreground/15 h-auto rounded-full px-4 py-1 font-semibold"
					>
						<Link href="/runs/5">View analysis</Link>
					</Button>
				</section>

				<section className="col-span-2 flex flex-col gap-2">
					<h2 className="text-sm font-semibold">Button: disabled (N/A)</h2>
					{/* N/A for this view: /leaderboard has no disabled control — its
					    only interactive elements are RunRow's always-enabled action
					    links and, in the empty state, the "Start a simulation" link.
					    Marked explicitly per /10x-ui's Definition of Done rather than
					    fabricating a disabled state that doesn't exist on this page. */}
					<p className="text-foreground/70 text-sm">
						No disabled control exists on /leaderboard.
					</p>
				</section>

				<section className="flex flex-col gap-2">
					<h2 className="text-sm font-semibold">Status card: error</h2>
					<div className={statusCardClassName}>
						<p>Couldn&apos;t load the leaderboard. Try reloading the page.</p>
					</div>
				</section>

				<section className="flex flex-col gap-2">
					<h2 className="text-sm font-semibold">Status card: empty</h2>
					<div className={statusCardClassName}>
						<p>No completed runs with a score yet.</p>
						<Button
							asChild
							className="bg-background text-foreground hover:bg-foreground/15 h-auto rounded-full px-6 py-2 font-semibold"
						>
							<Link href="/simulation">Start a simulation</Link>
						</Button>
					</div>
				</section>

				<section className="col-span-2 flex flex-col gap-2">
					<h2 className="text-sm font-semibold">RunRow: loading</h2>
					<div className="flex w-full flex-col gap-6">
						<Skeleton className="h-24 w-full rounded-2xl" />
						<Skeleton className="h-24 w-full rounded-2xl" />
					</div>
				</section>
			</div>
		</div>
	);
}
