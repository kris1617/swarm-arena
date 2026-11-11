"use client";

import { useState } from "react";

import { MultiSimulationStage } from "~/app/simulation/multi/_components/multi-simulation-stage";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
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
// src/app/simulation/page.tsx's (S-01's exact parameter set only — no
// predator/food fields), not a shared/extracted component. See plan.md
// "What We're NOT Doing": extracting a shared form would touch exactly the
// file S-02 is concurrently editing.
const MAX_BOID_COUNT = 500;

const EMPTY_STATE: RunSlotsState = { slots: [], activeRunId: null };

export default function MultiSimulationPage() {
	const [boidCount, setBoidCount] = useState(100);
	const [separationWeight, setSeparationWeight] = useState(1);
	const [alignmentWeight, setAlignmentWeight] = useState(1);
	const [cohesionWeight, setCohesionWeight] = useState(1);
	const [maxDurationSeconds, setMaxDurationSeconds] = useState(30);
	const [runSlotsState, setRunSlotsState] =
		useState<RunSlotsState>(EMPTY_STATE);

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
				}),
			);
		},
	});

	const atCap = runSlotsState.slots.length >= MAX_PARALLEL_RUNS;

	function handleFinished(runId: number, score: number) {
		setRunSlotsState((state) => markStopped(state, runId, score));
	}

	function handleView(runId: number) {
		setRunSlotsState((state) => setActive(state, runId));
	}

	function handleDismiss(runId: number) {
		setRunSlotsState((state) => removeSlot(state, runId));
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
								{slot.status === "stopped" && slot.score !== undefined
									? ` — Score: ${slot.score.toFixed(2)}`
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
					slots={runSlotsState.slots}
				/>
			) : null}
		</main>
	);
}
