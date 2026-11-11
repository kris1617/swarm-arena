"use client";

import { useState } from "react";

import { SimulationCanvas } from "~/app/simulation/_components/simulation-canvas";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { api } from "~/trpc/react";

// FR-018 object-count guardrail for this slice (S-01): a hardcoded client
// cap. S-04's admin-configurable cap is a separate, later change.
const MAX_BOID_COUNT = 500;

type ActiveRun = {
	runId: number;
	seed: number;
	boidCount: number;
	weights: { separation: number; alignment: number; cohesion: number };
	maxDurationSeconds: number;
};

export default function SimulationPage() {
	const [boidCount, setBoidCount] = useState(100);
	const [separationWeight, setSeparationWeight] = useState(1);
	const [alignmentWeight, setAlignmentWeight] = useState(1);
	const [cohesionWeight, setCohesionWeight] = useState(1);
	const [maxDurationSeconds, setMaxDurationSeconds] = useState(30);
	const [activeRun, setActiveRun] = useState<ActiveRun | null>(null);

	const startRun = api.simulation.start.useMutation({
		onSuccess: (data, variables) => {
			setActiveRun({
				runId: data.runId,
				seed: data.seed,
				// Use the clamped boidCount actually sent to (and stored by) the
				// server, not the raw form state, so the client-side simulation
				// never runs with a count the FR-018 guardrail didn't permit.
				boidCount: variables.boidCount,
				weights: {
					separation: separationWeight,
					alignment: alignmentWeight,
					cohesion: cohesionWeight,
				},
				maxDurationSeconds,
			});
		},
	});

	return (
		<main className="from-primary to-background text-foreground flex min-h-screen flex-col items-center justify-center gap-8 bg-gradient-to-b p-8">
			<h1 className="text-3xl font-bold">Flocking Simulation</h1>

			{activeRun ? (
				<SimulationCanvas
					boidCount={activeRun.boidCount}
					key={activeRun.runId}
					maxDurationSeconds={activeRun.maxDurationSeconds}
					onFinished={() => setActiveRun(null)}
					runId={activeRun.runId}
					seed={activeRun.seed}
					weights={activeRun.weights}
				/>
			) : (
				<form
					className="flex w-full max-w-xs flex-col gap-3"
					onSubmit={(e) => {
						e.preventDefault();
						startRun.mutate({
							boidCount: Math.min(
								Math.max(1, Math.round(boidCount)),
								MAX_BOID_COUNT,
							),
							separationWeight,
							alignmentWeight,
							cohesionWeight,
							maxDurationSeconds,
						});
					}}
				>
					<label className="flex flex-col gap-1" htmlFor="boid-count">
						Boid count (1-{MAX_BOID_COUNT})
						<Input
							className="bg-input text-foreground h-auto rounded-full border-0 px-4 py-2"
							id="boid-count"
							max={MAX_BOID_COUNT}
							min={1}
							onChange={(e) => setBoidCount(Number(e.target.value))}
							type="number"
							value={boidCount}
						/>
					</label>
					<label className="flex flex-col gap-1" htmlFor="separation-weight">
						Separation weight
						<Input
							className="bg-input text-foreground h-auto rounded-full border-0 px-4 py-2"
							id="separation-weight"
							onChange={(e) => setSeparationWeight(Number(e.target.value))}
							step="0.1"
							type="number"
							value={separationWeight}
						/>
					</label>
					<label className="flex flex-col gap-1" htmlFor="alignment-weight">
						Alignment weight
						<Input
							className="bg-input text-foreground h-auto rounded-full border-0 px-4 py-2"
							id="alignment-weight"
							onChange={(e) => setAlignmentWeight(Number(e.target.value))}
							step="0.1"
							type="number"
							value={alignmentWeight}
						/>
					</label>
					<label className="flex flex-col gap-1" htmlFor="cohesion-weight">
						Cohesion weight
						<Input
							className="bg-input text-foreground h-auto rounded-full border-0 px-4 py-2"
							id="cohesion-weight"
							onChange={(e) => setCohesionWeight(Number(e.target.value))}
							step="0.1"
							type="number"
							value={cohesionWeight}
						/>
					</label>
					<label className="flex flex-col gap-1" htmlFor="max-duration-seconds">
						Max duration (seconds)
						<Input
							className="bg-input text-foreground h-auto rounded-full border-0 px-4 py-2"
							id="max-duration-seconds"
							min={1}
							onChange={(e) => setMaxDurationSeconds(Number(e.target.value))}
							type="number"
							value={maxDurationSeconds}
						/>
					</label>
					<Button
						className="bg-input text-foreground hover:bg-foreground/35 h-auto rounded-full px-10 py-3 font-semibold"
						disabled={startRun.isPending}
						type="submit"
					>
						{startRun.isPending ? "Starting..." : "Start"}
					</Button>
					{startRun.error ? (
						<p className="text-destructive">{startRun.error.message}</p>
					) : null}
				</form>
			)}
		</main>
	);
}
