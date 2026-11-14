"use client";

import { useEffect, useRef, useState } from "react";
import { ServerRunViewer } from "~/app/simulation/_components/server-run-viewer";
import { SimulationCanvas } from "~/app/simulation/_components/simulation-canvas";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Switch } from "~/components/ui/switch";
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
	flockCount: number;
	crossbreedingEnabled: boolean;
	energyThreshold: number;
	mutationChance: number;
	mutationMagnitude: number;
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
	const [flockCount, setFlockCount] = useState(2);
	const [crossbreedingEnabled, setCrossbreedingEnabled] = useState(true);
	const [energyThreshold, setEnergyThreshold] = useState(50);
	const [mutationChance, setMutationChance] = useState(0.1);
	const [mutationMagnitude, setMutationMagnitude] = useState(0.2);
	const [activeRun, setActiveRun] = useState<ActiveRun | null>(null);
	// S-07: which server run (if any) the viewer below is currently watching.
	const [viewingRunId, setViewingRunId] = useState<number | null>(null);
	// S-08: every currently-running server simulation this user has, for the
	// list/switch panel below — polled rather than pushed, since the list
	// itself changes rarely. Independent of `activeRun` so server runs never
	// hide the staging form.
	const runningRunsQuery = api.simulation.listRunning.useQuery(undefined, {
		refetchInterval: 2000,
	});

	// impl-review (S-08): without this, a run that naturally stops drops out
	// of the list (and its switcher button) within one poll, while the
	// mounted ServerRunViewer keeps showing its last-drawn frame forever with
	// no indication — the list says "gone" and the canvas says "still
	// going". Stop viewing automatically once the viewed run is confirmed no
	// longer in the running list.
	//
	// `seenRunningIds` guards a real race: starting a server run sets
	// `viewingRunId` immediately, but the list's first poll hasn't included
	// it yet — without this guard, that gap would read as "not in the list"
	// and immediately clear the id that was just set. Only a run we've
	// previously confirmed as running, that has since disappeared, counts as
	// "stopped"; a run never yet seen is "not loaded yet", not "gone".
	const seenRunningIds = useRef(new Set<number>());
	useEffect(() => {
		if (!runningRunsQuery.data) {
			return;
		}
		for (const run of runningRunsQuery.data) {
			seenRunningIds.current.add(run.id);
		}
		if (
			viewingRunId !== null &&
			seenRunningIds.current.has(viewingRunId) &&
			!runningRunsQuery.data.some((run) => run.id === viewingRunId)
		) {
			setViewingRunId(null);
		}
	}, [viewingRunId, runningRunsQuery.data]);

	// Shared by both the staging "Start" button and the "Start on server"
	// button — identical clamping, diverging only in which mutation receives
	// the result and what happens on success.
	function buildStartInput() {
		return {
			boidCount: Math.min(Math.max(1, Math.round(boidCount)), MAX_BOID_COUNT),
			separationWeight,
			alignmentWeight,
			cohesionWeight,
			maxDurationSeconds,
			// Clamped against the same 500 ceiling used server-side for the
			// combined FR-018 boid+predator object-count cap.
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
			flockCount: Math.min(Math.max(2, Math.round(flockCount)), 4),
			crossbreedingEnabled,
			energyThreshold: Math.max(0.1, energyThreshold),
			mutationChance: Math.min(Math.max(0, mutationChance), 1),
			mutationMagnitude: Math.min(Math.max(0, mutationMagnitude), 1),
		};
	}

	const startServerMutation = api.simulation.startServer.useMutation({
		onSuccess: (data) => {
			// View the run just started immediately, rather than waiting for
			// the list's next 2s poll to pick it up.
			setViewingRunId(data.runId);
		},
	});

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
				flockCount: variables.flockCount,
				crossbreedingEnabled: variables.crossbreedingEnabled,
				energyThreshold: variables.energyThreshold,
				mutationChance: variables.mutationChance,
				mutationMagnitude: variables.mutationMagnitude,
			});
		},
	});

	return (
		<main className="from-primary to-background text-foreground flex min-h-screen flex-col items-center justify-center gap-8 bg-gradient-to-b p-8">
			<h1 className="text-3xl font-bold">Flocking Simulation</h1>

			{viewingRunId ? (
				<ServerRunViewer
					key={viewingRunId}
					onClose={() => setViewingRunId(null)}
					runId={viewingRunId}
				/>
			) : null}

			{runningRunsQuery.data && runningRunsQuery.data.length > 0 ? (
				<div className="bg-input text-foreground flex w-full max-w-xs flex-col items-center gap-2 rounded-2xl px-4 py-3 text-center">
					<p>
						Running on server — it keeps running even if you close this tab.
					</p>
					<div className="flex flex-wrap justify-center gap-2">
						{runningRunsQuery.data.map((run) => (
							<Button
								className={
									run.id === viewingRunId
										? "bg-foreground/35 text-foreground h-auto rounded-full px-6 py-2 font-semibold"
										: "bg-background text-foreground hover:bg-foreground/15 h-auto rounded-full px-6 py-2 font-semibold"
								}
								key={run.id}
								onClick={() => setViewingRunId(run.id)}
								type="button"
							>
								Run #{run.id}
							</Button>
						))}
					</div>
				</div>
			) : null}

			{activeRun ? (
				<SimulationCanvas
					boidCount={activeRun.boidCount}
					crossbreedingEnabled={activeRun.crossbreedingEnabled}
					energyThreshold={activeRun.energyThreshold}
					flockCount={activeRun.flockCount}
					foodRegenRate={activeRun.foodRegenRate}
					foodStockInitial={activeRun.foodStockInitial}
					key={activeRun.runId}
					maxDurationSeconds={activeRun.maxDurationSeconds}
					mutationChance={activeRun.mutationChance}
					mutationMagnitude={activeRun.mutationMagnitude}
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
						startRun.mutate(buildStartInput());
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
					<label className="flex flex-col gap-1" htmlFor="flock-count">
						Flock count (2-4)
						<Input
							className="bg-input text-foreground h-auto rounded-full border-0 px-4 py-2"
							id="flock-count"
							max={4}
							min={2}
							onChange={(e) => setFlockCount(Number(e.target.value))}
							type="number"
							value={flockCount}
						/>
					</label>
					<label
						className="flex items-center justify-between gap-2"
						htmlFor="crossbreeding-enabled"
					>
						Crossbreeding enabled
						<Switch
							checked={crossbreedingEnabled}
							id="crossbreeding-enabled"
							onCheckedChange={setCrossbreedingEnabled}
						/>
					</label>
					<label className="flex flex-col gap-1" htmlFor="energy-threshold">
						Energy threshold
						<Input
							className="bg-input text-foreground h-auto rounded-full border-0 px-4 py-2"
							id="energy-threshold"
							min={0}
							onChange={(e) => setEnergyThreshold(Number(e.target.value))}
							step="1"
							type="number"
							value={energyThreshold}
						/>
					</label>
					<label className="flex flex-col gap-1" htmlFor="mutation-chance">
						Mutation chance
						<Input
							className="bg-input text-foreground h-auto rounded-full border-0 px-4 py-2"
							id="mutation-chance"
							max={1}
							min={0}
							onChange={(e) => setMutationChance(Number(e.target.value))}
							step="0.05"
							type="number"
							value={mutationChance}
						/>
					</label>
					<label className="flex flex-col gap-1" htmlFor="mutation-magnitude">
						Mutation magnitude
						<Input
							className="bg-input text-foreground h-auto rounded-full border-0 px-4 py-2"
							id="mutation-magnitude"
							max={1}
							min={0}
							onChange={(e) => setMutationMagnitude(Number(e.target.value))}
							step="0.05"
							type="number"
							value={mutationMagnitude}
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
					<Button
						className="bg-input text-foreground hover:bg-foreground/35 h-auto rounded-full px-10 py-3 font-semibold"
						disabled={startServerMutation.isPending}
						onClick={() => startServerMutation.mutate(buildStartInput())}
						type="button"
					>
						{startServerMutation.isPending
							? "Starting on server..."
							: "Start on server"}
					</Button>
					{startServerMutation.error ? (
						<p className="text-destructive">
							{startServerMutation.error.message}
						</p>
					) : null}
				</form>
			)}
		</main>
	);
}
