"use client";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";

// Visual gate for the Button/Input styling used by `~/app/simulation/page.tsx`.
// Renders all 7 states from /10x-ui's Definition of Done side by side so each
// one is visible at once for a screenshot, instead of coaxing the real view
// into each state manually. This repo has no screenshot-testing tool
// installed and none is being added for this change — reviewing this page
// directly is the gate.
//
// classNames below are copied verbatim from `page.tsx`'s Button/Input usage
// (not shadcn's bare defaults) so this proves the actual styled components
// the real view renders, not generic ones.
export default function KitchenSinkPage() {
	return (
		<main className="from-primary to-background text-foreground flex min-h-screen flex-col items-center justify-center gap-8 bg-gradient-to-b p-8">
			<h1 className="text-3xl font-bold">Kitchen Sink</h1>
			<div className="grid w-full max-w-2xl grid-cols-2 gap-6">
				<section className="flex flex-col gap-2">
					<h2 className="text-sm font-semibold">Button: default</h2>
					<Button className="bg-input text-foreground hover:bg-foreground/35 h-auto rounded-full px-10 py-3 font-semibold">
						Start
					</Button>
				</section>

				<section className="flex flex-col gap-2">
					<h2 className="text-sm font-semibold">Button: hover</h2>
					{/* Hover is a pointer-driven pseudo-class and can't be forced in a
					    static render. For the screenshot step, hover the pointer over
					    this button to capture `hover:bg-foreground/35`. */}
					<Button className="bg-input text-foreground hover:bg-foreground/35 h-auto rounded-full px-10 py-3 font-semibold">
						Start
					</Button>
				</section>

				<section className="flex flex-col gap-2">
					<h2 className="text-sm font-semibold">Button: disabled</h2>
					<Button
						className="bg-input text-foreground hover:bg-foreground/35 h-auto rounded-full px-10 py-3 font-semibold"
						disabled
					>
						Start
					</Button>
				</section>

				<section className="flex flex-col gap-2">
					<h2 className="text-sm font-semibold">Button: loading</h2>
					<Button
						className="bg-input text-foreground hover:bg-foreground/35 h-auto rounded-full px-10 py-3 font-semibold"
						disabled
					>
						Starting...
					</Button>
				</section>

				<section className="flex flex-col gap-2">
					<h2 className="text-sm font-semibold">Input: focused</h2>
					<Input
						autoFocus
						className="bg-input text-foreground h-auto rounded-full border-0 px-4 py-2"
						defaultValue={30}
						id="kitchen-sink-focused"
						type="number"
					/>
				</section>

				<section className="flex flex-col gap-2">
					<h2 className="text-sm font-semibold">Input: empty</h2>
					<Input
						className="bg-input text-foreground h-auto rounded-full border-0 px-4 py-2"
						id="kitchen-sink-empty"
						placeholder="Boid count (1-500)"
						type="number"
					/>
				</section>

				<section className="col-span-2 flex flex-col gap-2">
					<h2 className="text-sm font-semibold">Input: error</h2>
					<Input
						aria-invalid
						className="bg-input text-foreground h-auto rounded-full border-0 px-4 py-2"
						defaultValue={-1}
						id="kitchen-sink-error"
						type="number"
					/>
					<p className="text-destructive">Boid count must be at least 1.</p>
				</section>
			</div>
		</main>
	);
}
