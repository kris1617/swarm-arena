"use client";

import { useState } from "react";

import { SimulationCanvas } from "~/app/simulation/_components/simulation-canvas";
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
		<main className="flex min-h-screen flex-col items-center justify-center gap-8 bg-gradient-to-b from-[#2e026d] to-[#15162c] p-8 text-white">
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
					<label className="flex flex-col gap-1">
						Boid count (1-{MAX_BOID_COUNT})
						<input
							className="rounded-full bg-white/10 px-4 py-2 text-white"
							max={MAX_BOID_COUNT}
							min={1}
							onChange={(e) => setBoidCount(Number(e.target.value))}
							type="number"
							value={boidCount}
						/>
					</label>
					<label className="flex flex-col gap-1">
						Separation weight
						<input
							className="rounded-full bg-white/10 px-4 py-2 text-white"
							onChange={(e) => setSeparationWeight(Number(e.target.value))}
							step="0.1"
							type="number"
							value={separationWeight}
						/>
					</label>
					<label className="flex flex-col gap-1">
						Alignment weight
						<input
							className="rounded-full bg-white/10 px-4 py-2 text-white"
							onChange={(e) => setAlignmentWeight(Number(e.target.value))}
							step="0.1"
							type="number"
							value={alignmentWeight}
						/>
					</label>
					<label className="flex flex-col gap-1">
						Cohesion weight
						<input
							className="rounded-full bg-white/10 px-4 py-2 text-white"
							onChange={(e) => setCohesionWeight(Number(e.target.value))}
							step="0.1"
							type="number"
							value={cohesionWeight}
						/>
					</label>
					<label className="flex flex-col gap-1">
						Max duration (seconds)
						<input
							className="rounded-full bg-white/10 px-4 py-2 text-white"
							min={1}
							onChange={(e) => setMaxDurationSeconds(Number(e.target.value))}
							type="number"
							value={maxDurationSeconds}
						/>
					</label>
					<button
						className="rounded-full bg-white/10 px-10 py-3 font-semibold transition hover:bg-white/20"
						disabled={startRun.isPending}
						type="submit"
					>
						{startRun.isPending ? "Starting..." : "Start"}
					</button>
					{startRun.error ? (
						<p className="text-red-300">{startRun.error.message}</p>
					) : null}
				</form>
			)}
		</main>
	);
}
