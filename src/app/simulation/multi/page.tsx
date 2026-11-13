"use client";

import { useState } from "react";

import { MultiSimulationStage } from "~/app/simulation/multi/_components/multi-simulation-stage";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Switch } from "~/components/ui/switch";
import {
	addSlot,
	MAX_PARALLEL_RUNS,
	markStopped,
	type RunSlotsState,
	removeSlot,
	setActive,
} from "~/server/simulation/run-slots";
import { api } from "~/trpc/react";

// S-05 (parallel-sim-switching): this form is an independent duplicate of
// src/app/simulation/page.tsx's, not a shared/extracted component. Per the
// genetic-inheritance-crossbreeding plan's mid-implementation addition, both
// forms now carry the same full field set (predator/food + genetics) so
// multi-run gets predators/food/reproduction parity with single-run — see
// plan.md "What We're NOT Doing": extracting a shared form stays out of
// scope even though the field sets are now identical.
const MAX_BOID_COUNT = 500;

const EMPTY_STATE: RunSlotsState = { slots: [], activeRunId: null };

export default function MultiSimulationPage() {
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
	const [runSlotsState, setRunSlotsState] =
		useState<RunSlotsState>(EMPTY_STATE);
	// Per-slot latest populationCapped flag from MultiSimulationStage's shared
	// tick loop — kept in page state (not RunSlot itself) since it's a
	// tick-local UI concern, not part of a slot's identity/config.
	const [populationCappedByRunId, setPopulationCappedByRunId] = useState<
		Record<number, boolean>
	>({});

	const startRun = api.simulation.start.useMutation({
		onSuccess: (data, variables) => {
			setRunSlotsState((state) =>
				addSlot(state, {
					runId: data.runId,
					seed: data.seed,
					// Use the clamped boidCount actually sent to (and stored
					// by) the server, not the raw form state, so the
					// client-side simulation never runs with a count the
					// FR-018 guardrail didn't permit.
					boidCount: variables.boidCount,
					weights: {
						separation: separationWeight,
						alignment: alignmentWeight,
						cohesion: cohesionWeight,
					},
					maxDurationSeconds,
					// Use the clamped/validated values actually sent to (and stored
					// by) the server, same rationale as boidCount above.
					predatorCount: variables.predatorCount,
					protectionThreshold: variables.protectionThreshold,
					foodStockInitial: variables.foodStockInitial,
					foodRegenRate: variables.foodRegenRate,
					flockCount: variables.flockCount,
					crossbreedingEnabled: variables.crossbreedingEnabled,
					energyThreshold: variables.energyThreshold,
					mutationChance: variables.mutationChance,
					mutationMagnitude: variables.mutationMagnitude,
				}),
			);
		},
	});

	const atCap = runSlotsState.slots.length >= MAX_PARALLEL_RUNS;

	function handleFinished(runId: number, score?: number) {
		setRunSlotsState((state) => markStopped(state, runId, score));
	}

	function handleView(runId: number) {
		setRunSlotsState((state) => setActive(state, runId));
	}

	function handleDismiss(runId: number) {
		setRunSlotsState((state) => removeSlot(state, runId));
	}

	function handlePopulationCapped(runId: number, capped: boolean) {
		setPopulationCappedByRunId((state) => ({ ...state, [runId]: capped }));
	}

	return (
		<main className="from-primary to-background text-foreground flex min-h-screen flex-col items-center justify-center gap-8 bg-gradient-to-b p-8">
			<h1 className="text-3xl font-bold">Parallel Flocking Simulations</h1>

			{atCap ? (
				<p className="text-center">
					{MAX_PARALLEL_RUNS} simulations are running in parallel — the maximum.
					Dismiss a finished run to start a new one.
				</p>
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
							flockCount: Math.min(Math.max(2, Math.round(flockCount)), 4),
							crossbreedingEnabled,
							energyThreshold: Math.max(0.1, energyThreshold),
							mutationChance: Math.min(Math.max(0, mutationChance), 1),
							mutationMagnitude: Math.min(Math.max(0, mutationMagnitude), 1),
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
				</form>
			)}

			{runSlotsState.slots.length > 0 ? (
				<ul className="flex w-full max-w-md flex-col gap-2">
					{runSlotsState.slots.map((slot, index) => (
						<li
							className="bg-input/40 flex items-center justify-between gap-3 rounded-full px-4 py-2"
							key={slot.runId}
						>
							<span>
								Run {index + 1} —{" "}
								{slot.status === "running" ? "Running" : "Stopped"}
								{slot.status === "running" &&
								populationCappedByRunId[slot.runId]
									? " — Population capped — at the object limit"
									: null}
								{slot.status === "stopped"
									? slot.score !== undefined
										? ` — Score: ${slot.score.toFixed(2)}`
										: " — Score unavailable (stop failed)"
									: null}
							</span>
							<span className="flex gap-2">
								<Button
									className="bg-input text-foreground hover:bg-foreground/35 h-auto rounded-full px-4 py-1 text-sm font-semibold"
									disabled={slot.runId === runSlotsState.activeRunId}
									onClick={() => handleView(slot.runId)}
									type="button"
								>
									View
								</Button>
								{slot.status === "stopped" ? (
									<Button
										className="bg-input text-foreground hover:bg-foreground/35 h-auto rounded-full px-4 py-1 text-sm font-semibold"
										onClick={() => handleDismiss(slot.runId)}
										type="button"
									>
										Dismiss
									</Button>
								) : null}
							</span>
						</li>
					))}
				</ul>
			) : null}

			{runSlotsState.slots.length > 0 ? (
				<MultiSimulationStage
					activeRunId={runSlotsState.activeRunId}
					onFinished={handleFinished}
					onPopulationCapped={handlePopulationCapped}
					slots={runSlotsState.slots}
				/>
			) : null}
		</main>
	);
}
