"use client";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { NumberField } from "~/components/ui/number-field";

// Visual gate for the NumberField/Button/Input styling used by
// `~/app/admin/settings/_components/admin-settings-form.tsx` and
// `~/app/admin/elevation/_components/elevation-form.tsx`. Renders all
// applicable states from /10x-ui's Definition of Done side by side so each
// one is visible at once for a screenshot, instead of coaxing the real forms
// into each state manually. This repo has no screenshot-testing tool
// installed and none is being added for this change — reviewing this page
// directly is the gate.
//
// classNames below are copied verbatim from the two forms' usage (not
// generic defaults) so this proves the actual styled components the real
// views render, not generic ones.
//
// Root element is a `<div>`, not `<main>` — `AppShell`'s `SidebarInset`
// already renders the page's one `<main>` landmark (see AGENTS.md's UI
// section).
//
// Unlike the leaderboard/runs kitchen sinks, both admin forms have no
// filter/row interactivity — their real surface is NumberField (default and
// the settings form's compact `className` variant), a mutation-pending
// disabled Button, the `mutation.error` text-destructive paragraph both
// forms already render, and the elevation form's one non-NumberField
// control, its `target-email` text input.
export default function AdminKitchenSinkPage() {
	return (
		<div className="from-primary to-background text-foreground flex min-h-screen flex-col items-center justify-center gap-8 bg-gradient-to-b p-8">
			<h1 className="text-3xl font-bold">Admin Kitchen Sink</h1>
			<div className="grid w-full max-w-2xl grid-cols-2 gap-6">
				<section className="col-span-2 flex flex-col gap-2">
					<h2 className="text-sm font-semibold">NumberField: default</h2>
					<div className="bg-input flex flex-col gap-1 rounded-2xl px-4 py-3">
						<NumberField
							id="default-count"
							label="Global max object count (FR-018)"
							min={1}
							onChange={() => undefined}
							value={500}
						/>
					</div>
				</section>

				<section className="col-span-2 flex flex-col gap-2">
					<h2 className="text-sm font-semibold">NumberField: hover</h2>
					{/* Hover is a pointer-driven pseudo-class and can't be forced in a
					    static render. For the screenshot step, hover the pointer over
					    this field's input to capture its hover state. */}
					<div className="bg-input flex flex-col gap-1 rounded-2xl px-4 py-3">
						<NumberField
							id="hover-count"
							label="Max combined object count across concurrent server runs (F-07)"
							min={1}
							onChange={() => undefined}
							value={150}
						/>
					</div>
				</section>

				<section className="col-span-2 flex flex-col gap-2">
					<h2 className="text-sm font-semibold">NumberField: focus-visible</h2>
					{/* To trigger this state during review, Tab into the page until
					    focus lands on this field's input (or click elsewhere first,
					    then press Tab) — the ring should use the `--ring` token via
					    `focus-visible:ring-ring/50`, not a browser default outline. */}
					<div className="bg-input flex flex-col gap-1 rounded-2xl px-4 py-3">
						<NumberField
							id="focus-duration"
							label="Duration (minutes)"
							max={1440}
							min={1}
							onChange={() => undefined}
							value={60}
						/>
					</div>
				</section>

				<section className="col-span-2 flex flex-col gap-2">
					<h2 className="text-sm font-semibold">
						NumberField: className variant
					</h2>
					{/* Side-by-side comparison confirms the settings form's compact
					    `bg-transparent px-3 py-1` className override composes with
					    NumberField's default classes instead of replacing them. */}
					<div className="bg-input flex flex-col gap-1 rounded-2xl px-4 py-3">
						<div className="flex gap-2">
							<NumberField
								id="variant-default"
								label="Default"
								onChange={() => undefined}
								step="any"
								value={50}
							/>
							<NumberField
								className="bg-transparent px-3 py-1"
								id="variant-compact"
								label="Default"
								onChange={() => undefined}
								step="any"
								value={50}
							/>
						</div>
					</div>
				</section>

				<section className="col-span-2 flex flex-col gap-2">
					<h2 className="text-sm font-semibold">Button: disabled</h2>
					{/* Copied verbatim from elevation-form.tsx's "Become admin" button
					    — the mutation-pending-style disabled state both forms share. */}
					<Button
						className="bg-background text-foreground hover:bg-foreground/15 h-auto rounded-full px-6 py-2 font-semibold"
						disabled
						type="button"
					>
						Elevating...
					</Button>
				</section>

				<section className="col-span-2 flex flex-col gap-2">
					<h2 className="text-sm font-semibold">Error message</h2>
					{/* Copied verbatim from both forms' `mutation.error` rendering. */}
					<p className="text-destructive">Something went wrong.</p>
				</section>

				<section className="col-span-2 flex flex-col gap-2">
					<h2 className="text-sm font-semibold">Text input</h2>
					{/* Copied verbatim from elevation-form.tsx's `target-email` field —
					    the one control on either admin form that isn't a NumberField. */}
					<label className="flex flex-col gap-1" htmlFor="target-email">
						Email
						<Input
							className="bg-background text-foreground h-auto rounded-full border-0 px-4 py-2"
							id="target-email"
							onChange={() => undefined}
							type="email"
							value="admin@example.com"
						/>
					</label>
				</section>
			</div>
		</div>
	);
}
