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
	predatorCount: number;
	protectionThreshold: number;
	foodStockInitial: number;
	foodRegenRate: number;
};

export default function SimulationPage() {
	const [boidCount, setBoidCount] = useState(100);
	const [separationWeight, setSeparationWeight] = useState(1);
	const [alignmentWeight, setAlignmentWeight] = useState(1);
	const [cohesionWeight, setCohesionWeight] = useState(1);
	const [maxDurationSeconds, setMaxDurationSeconds] = useState(30);
	const [predatorCount, setPredatorCount] = useState(5);
	const [protectionThreshold, setProtectionThreshold] = useState(10);
	const [foodStockInitial, setFoodStockInitial] = useState(100);
	const [foodRegenRate, setFoodRegenRate] = useState(10);
	const [activeRun, setActiveRun] = useState<ActiveRun | null>(null);

	const startRun = api.simulation.start.useMutation({
		onSuccess: (data, variables) => {
			setActiveRun({
				runId: data.runId,
				seed: data.seed,
				// Use the clamped/validated values actually sent to (and stored
				// by) the server, not the raw form state, so the client-side
				// simulation never runs with a value the server didn't accept.
				boidCount: variables.boidCount,
				weights: {
					separation: separationWeight,
					alignment: alignmentWeight,
					cohesion: cohesionWeight,
				},
				maxDurationSeconds,
				predatorCount: variables.predatorCount,
				protectionThreshold: variables.protectionThreshold,
				foodStockInitial: variables.foodStockInitial,
				foodRegenRate: variables.foodRegenRate,
			});
		},
	});

	return (
		<main className="from-primary to-background text-foreground flex min-h-screen flex-col items-center justify-center gap-8 bg-gradient-to-b p-8">
			<h1 className="text-3xl font-bold">Flocking Simulation</h1>

			{activeRun ? (
				<SimulationCanvas
					boidCount={activeRun.boidCount}
					foodRegenRate={activeRun.foodRegenRate}
					foodStockInitial={activeRun.foodStockInitial}
					key={activeRun.runId}
					maxDurationSeconds={activeRun.maxDurationSeconds}
					onFinished={() => setActiveRun(null)}
					predatorCount={activeRun.predatorCount}
					protectionThreshold={activeRun.protectionThreshold}
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
							// Clamped against the same 500 ceiling used server-side for
							// the combined FR-018 boid+predator object-count cap.
							predatorCount: Math.min(
								Math.max(0, Math.round(predatorCount)),
								MAX_BOID_COUNT,
							),
							protectionThreshold: Math.min(
								Math.max(0, Math.round(protectionThreshold)),
								MAX_BOID_COUNT,
							),
							foodStockInitial: Math.max(0.1, foodStockInitial),
							foodRegenRate: Math.max(0, foodRegenRate),
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
					<label className="flex flex-col gap-1" htmlFor="predator-count">
						Predator count (0-{MAX_BOID_COUNT})
						<Input
							className="bg-input text-foreground h-auto rounded-full border-0 px-4 py-2"
							id="predator-count"
							max={MAX_BOID_COUNT}
							min={0}
							onChange={(e) => setPredatorCount(Number(e.target.value))}
							type="number"
							value={predatorCount}
						/>
					</label>
					<label className="flex flex-col gap-1" htmlFor="protection-threshold">
						Protection threshold (0-{MAX_BOID_COUNT})
						<Input
							className="bg-input text-foreground h-auto rounded-full border-0 px-4 py-2"
							id="protection-threshold"
							max={MAX_BOID_COUNT}
							min={0}
							onChange={(e) => setProtectionThreshold(Number(e.target.value))}
							type="number"
							value={protectionThreshold}
						/>
					</label>
					<label className="flex flex-col gap-1" htmlFor="food-stock-initial">
						Initial food stock
						<Input
							className="bg-input text-foreground h-auto rounded-full border-0 px-4 py-2"
							id="food-stock-initial"
							min={0}
							onChange={(e) => setFoodStockInitial(Number(e.target.value))}
							step="0.1"
							type="number"
							value={foodStockInitial}
						/>
					</label>
					<label className="flex flex-col gap-1" htmlFor="food-regen-rate">
						Food regen rate
						<Input
							className="bg-input text-foreground h-auto rounded-full border-0 px-4 py-2"
							id="food-regen-rate"
							min={0}
							onChange={(e) => setFoodRegenRate(Number(e.target.value))}
							step="0.1"
							type="number"
							value={foodRegenRate}
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
