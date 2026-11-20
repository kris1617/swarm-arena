"use client";

import Link from "next/link";
import { RunRow } from "~/components/run-row";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "~/components/ui/tabs";

// Visual gate for the RunRow/Tabs styling used by `~/app/dashboard/page.tsx`.
// Renders all 7 states from /10x-ui's Definition of Done side by side so each
// one is visible at once for a screenshot, instead of coaxing the real view
// into each state manually. This repo has no screenshot-testing tool
// installed and none is being added for this change — reviewing this page
// directly is the gate.
//
// classNames below are copied verbatim from `page.tsx`'s RunRow/Tabs/Button
// usage (not generic defaults) so this proves the actual styled components
// the real view renders, not generic ones.
//
// Root element is a `<div>`, not `<main>` — `AppShell`'s `SidebarInset`
// already renders the page's one `<main>` landmark (see AGENTS.md's UI
// section). The existing `src/app/simulation/kitchen-sink/page.tsx` predates
// that rule and is out of this change's scope to fix.
//
// Duplicated below rather than imported: `statusCardClassName` in
// `dashboard/page.tsx` is a local (non-exported) const, and this change does
// not touch `dashboard/page.tsx` in Phase 2 — keep this string in sync with
// that file's `statusCardClassName` by hand.
const statusCardClassName =
	"bg-input text-foreground flex w-full max-w-md flex-col items-center gap-3 rounded-2xl px-6 py-8 text-center";

export default function DashboardKitchenSinkPage() {
	return (
		<div className="from-primary to-background text-foreground flex min-h-screen flex-col items-center justify-center gap-8 bg-gradient-to-b p-8">
			<h1 className="text-3xl font-bold">Dashboard Kitchen Sink</h1>
			<div className="grid w-full max-w-2xl grid-cols-2 gap-6">
				<section className="col-span-2 flex flex-col gap-2">
					<h2 className="text-sm font-semibold">RunRow: default</h2>
					<div className="bg-input text-foreground flex flex-col gap-2 rounded-2xl px-4 py-3">
						<RunRow
							actionHref="/simulation"
							actionLabel="View"
							label={
								<span>Run #1 — 120 boids, 4 predators — started just now</span>
							}
						/>
					</div>
				</section>

				<section className="col-span-2 flex flex-col gap-2">
					<h2 className="text-sm font-semibold">RunRow: hover</h2>
					{/* Hover is a pointer-driven pseudo-class and can't be forced in a
					    static render. For the screenshot step, hover the pointer over
					    this row's "View" button to capture its `hover:bg-foreground/15`. */}
					<div className="bg-input text-foreground flex flex-col gap-2 rounded-2xl px-4 py-3">
						<RunRow
							actionHref="/simulation"
							actionLabel="View"
							label={
								<span>Run #2 — 120 boids, 4 predators — started just now</span>
							}
						/>
					</div>
				</section>

				<section className="col-span-2 flex flex-col gap-2">
					<h2 className="text-sm font-semibold">Tabs: focus-visible</h2>
					{/* Radix requires a Tabs/TabsList wrapper for a TabsTrigger to
					    mount. To trigger this state during review, Tab into the page
					    until focus lands on one of these triggers (or click elsewhere
					    first, then press Tab) — the ring should use the `--ring`
					    token via `focus-visible:ring-ring/50`, not a browser default
					    outline. */}
					<Tabs value="all">
						<TabsList>
							<TabsTrigger value="all">All</TabsTrigger>
							<TabsTrigger value="running">Running</TabsTrigger>
						</TabsList>
					</Tabs>
				</section>

				<section className="col-span-2 flex flex-col gap-2">
					<h2 className="text-sm font-semibold">Button: disabled</h2>
					<Button
						className="h-auto self-start rounded-full px-6 py-2 font-semibold"
						disabled
						type="button"
					>
						Compare selected
					</Button>
				</section>

				<section className="flex flex-col gap-2">
					<h2 className="text-sm font-semibold">Status card: error</h2>
					<div className={statusCardClassName}>
						<p>Couldn&apos;t load your simulations. Try reloading the page.</p>
					</div>
				</section>

				<section className="flex flex-col gap-2">
					<h2 className="text-sm font-semibold">Status card: empty</h2>
					<div className={statusCardClassName}>
						<p>You haven&apos;t started any simulations yet.</p>
						<Button
							asChild
							className="bg-background text-foreground hover:bg-foreground/15 h-auto rounded-full px-6 py-2 font-semibold"
						>
							<Link href="/simulation">Start a simulation</Link>
						</Button>
					</div>
				</section>

				<section className="col-span-2 flex flex-col gap-2">
					<h2 className="text-sm font-semibold">RunRow / loading</h2>
					<div className="flex w-full flex-col gap-6">
						<Skeleton className="h-24 w-full rounded-2xl" />
						<Skeleton className="h-24 w-full rounded-2xl" />
					</div>
				</section>
			</div>
		</div>
	);
}
