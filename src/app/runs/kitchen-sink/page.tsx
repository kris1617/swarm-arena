"use client";

import Link from "next/link";
import { AnalysisCard } from "~/components/analysis-card";
import { Button } from "~/components/ui/button";

// Visual gate for the AnalysisCard/Button styling used by
// `~/app/runs/[runId]/page.tsx` (and shared with `~/app/runs/compare/page.tsx`).
// Renders all applicable states from /10x-ui's Definition of Done side by
// side so each one is visible at once for a screenshot, instead of coaxing
// the real view into each state manually. This repo has no screenshot-testing
// tool installed and none is being added for this change — reviewing this
// page directly is the gate.
//
// classNames below are copied verbatim from `[runId]/page.tsx`'s Button usage
// (not generic defaults) so this proves the actual styled components the
// real view renders, not generic ones.
//
// Root element is a `<div>`, not `<main>` — `AppShell`'s `SidebarInset`
// already renders the page's one `<main>` landmark (see AGENTS.md's UI
// section).
//
// Unlike the dashboard/leaderboard kitchen sinks, this view has no
// filter/row interactivity (no Tabs, no RunRow hover/className variant) —
// its only interactive control is the export Button, and AnalysisCard itself
// has only two shapes (with/without title) plus a fallback-text branch when
// a section has no data.
export default function RunsKitchenSinkPage() {
	return (
		<div className="from-primary to-background text-foreground flex min-h-screen flex-col items-center justify-center gap-8 bg-gradient-to-b p-8">
			<h1 className="text-3xl font-bold">Runs Analysis Kitchen Sink</h1>
			<div className="grid w-full max-w-2xl grid-cols-2 gap-6">
				<section className="col-span-2 flex flex-col gap-2">
					<h2 className="text-sm font-semibold">AnalysisCard: with title</h2>
					<AnalysisCard title="Run suggestion">
						<p>Not enough data in this run to suggest a change.</p>
					</AnalysisCard>
				</section>

				<section className="col-span-2 flex flex-col gap-2">
					<h2 className="text-sm font-semibold">AnalysisCard: without title</h2>
					{/* The `wasAutoStopped`-notice shape in [runId]/page.tsx — no
					    `title` prop passed, so AnalysisCard renders without the
					    heading element. */}
					<AnalysisCard>
						<p>
							This run was stopped automatically — server restarted before it
							finished on its own.
						</p>
					</AnalysisCard>
				</section>

				<section className="col-span-2 flex flex-col gap-2">
					<h2 className="text-sm font-semibold">
						AnalysisCard: empty-section example
					</h2>
					{/* Representative example of the fallback-text branch every data
					    section falls back to when its run has no recorded data for
					    that section — one card stands in for all such branches rather
					    than repeating all 6 near-identical variants. */}
					<AnalysisCard title="Population over time">
						<p>No population data recorded for this run.</p>
					</AnalysisCard>
				</section>

				<section className="col-span-2 flex flex-col gap-2">
					<h2 className="text-sm font-semibold">Button: hover</h2>
					{/* Hover is a pointer-driven pseudo-class and can't be forced in a
					    static render. For the screenshot step, hover the pointer over
					    this button to capture its `hover:bg-foreground/15`. */}
					<Button
						asChild
						className="bg-input text-foreground hover:bg-foreground/15 h-auto rounded-full px-4 py-1 font-semibold"
					>
						<Link href="/api/runs/1/export?format=json">Export JSON</Link>
					</Button>
				</section>

				<section className="col-span-2 flex flex-col gap-2">
					<h2 className="text-sm font-semibold">Button: focus-visible</h2>
					{/* To trigger this state during review, Tab into the page until
					    focus lands on this button (or click elsewhere first, then
					    press Tab) — the ring should use the `--ring` token via
					    `focus-visible:ring-ring/50`, not a browser default outline. */}
					<Button
						asChild
						className="bg-input text-foreground hover:bg-foreground/15 h-auto rounded-full px-4 py-1 font-semibold"
					>
						<Link href="/api/runs/1/export?format=csv">Export CSV</Link>
					</Button>
				</section>

				<section className="col-span-2 flex flex-col gap-2">
					<h2 className="text-sm font-semibold">Button: disabled (N/A)</h2>
					{/* N/A for this view: /runs/[runId] and /runs/compare have no
					    disabled control — their only interactive elements are the
					    always-enabled export Buttons/Links. Marked explicitly per
					    /10x-ui's Definition of Done rather than fabricating a
					    disabled state that doesn't exist on either page. */}
					<p className="text-foreground/70 text-sm">
						No disabled control exists on /runs/[runId] or /runs/compare.
					</p>
				</section>
			</div>
		</div>
	);
}
