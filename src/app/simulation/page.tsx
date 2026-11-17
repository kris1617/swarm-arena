"use client";

import { useEffect, useRef, useState } from "react";
import { ServerRunViewer } from "~/app/simulation/_components/server-run-viewer";
import { SimulationCanvas } from "~/app/simulation/_components/simulation-canvas";
import { Button } from "~/components/ui/button";
import { NumberField } from "~/components/ui/number-field";
import { Skeleton } from "~/components/ui/skeleton";
import { Switch } from "~/components/ui/switch";
import type { TribeConfig } from "~/server/simulation/boids";
import { DEFAULT_PARAMETER_RANGES } from "~/server/simulation/parameter-ranges";
import { api } from "~/trpc/react";

type ActiveRun = {
	runId: number;
	seed: number;
	boidCount: number;
	// per-tribe-behavior-weights Phase 2: one TribeConfig per flock, index =
	// flockId — replaces the single shared `weights` value (every flock used
	// to seed from identical weights).
	tribeConfigs: TribeConfig[];
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
	xyArea: number;
	zDepth: number;
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
	// S-24 Phase 4: the simulation's configured spatial extent — same
	// useState/NumberField/buildStartInput-clamp pattern as every other
	// ranged parameter above.
	const [xyArea, setXyArea] = useState(200);
	const [zDepth, setZDepth] = useState(200);
	// S-04 (FR-002 full): admin-configured bounds, replacing the hardcoded
	// MAX_BOID_COUNT this form used before. Falls back to the same defaults
	// the admin-settings table seeds on first read, so the form isn't
	// broken on first paint before the query resolves.
	const rangesQuery = api.simulation.getParameterRanges.useQuery();
	const ranges = rangesQuery.data?.parameterRanges ?? DEFAULT_PARAMETER_RANGES;
	const maxObjectCount = rangesQuery.data?.maxObjectCount ?? 500;
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
	// S-04 Phase 4 (FR-012): paused server-owned runs, for the "Saved"
	// section's "Resume" list — same polling cadence as `listRunning`.
	const savedRunsQuery = api.simulation.listSaved.useQuery(undefined, {
		refetchInterval: 2000,
	});
	const utils = api.useUtils();
	const savePauseMutation = api.simulation.savePause.useMutation({
		onSuccess: () => {
			void utils.simulation.listRunning.invalidate();
			void utils.simulation.listSaved.invalidate();
		},
	});
	const resumeMutation = api.simulation.resume.useMutation({
		// Bug fix (found during S-24 Phase 4 manual verification): must AWAIT
		// the invalidation before setting viewingRunId, not fire-and-forget it
		// like savePauseMutation's onSuccess does. The seenRunningIds effect
		// below already has this run's id from before it was paused — if
		// viewingRunId is set while runningRunsQuery.data is still the stale
		// (pre-resume, run-not-listed) snapshot, that effect's "a previously
		// seen running id disappeared" check fires immediately and nulls
		// viewingRunId right back out, so the viewer never appears without a
		// manual re-click. Awaiting here ensures the list already includes
		// this run by the time viewingRunId updates.
		onSuccess: async (_data, variables) => {
			await Promise.all([
				utils.simulation.listRunning.invalidate(),
				utils.simulation.listSaved.invalidate(),
			]);
			setViewingRunId(variables.runId);
		},
	});
	// parameter-suggestion-heuristic Phase 2: advisory-only suggestion for the
	// staging form below — never auto-fills or changes the form's `useState`
	// fields, per the plan's "What We're NOT Doing".
	const suggestionQuery = api.simulation.getParameterSuggestion.useQuery();

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
	// the result and what happens on success. Clamps against the
	// admin-configured ranges (S-04/FR-002 full) instead of hardcoded
	// bounds.
	function buildStartInput() {
		const clampedFlockCount = Math.min(
			Math.max(ranges.flockCount.min, Math.round(flockCount)),
			ranges.flockCount.max,
		);
		// per-tribe-behavior-weights Phase 1: bridge value — uniform across
		// every tribe, matching this form's own current scalar weights plus
		// each new field's admin-range default, so starting a run behaves
		// identically to pre-change behavior until Phase 8 replaces this with
		// the real per-tribe tabbed UI.
		const tribeConfig = {
			separation: Math.min(
				Math.max(ranges.separationWeight.min, separationWeight),
				ranges.separationWeight.max,
			),
			alignment: Math.min(
				Math.max(ranges.alignmentWeight.min, alignmentWeight),
				ranges.alignmentWeight.max,
			),
			cohesion: Math.min(
				Math.max(ranges.cohesionWeight.min, cohesionWeight),
				ranges.cohesionWeight.max,
			),
			maxSpeed: 40,
			minSpeed: 15,
			matePreference: ranges.matePreference.default,
			neighborRadius: ranges.neighborRadius.default,
			separationRadius: ranges.separationRadius.default,
			predatorDetectionRadius: ranges.predatorDetectionRadius.default,
			burstMult: ranges.burstMult.default,
			burstCostMult: ranges.burstCostMult.default,
		};
		const tribeConfigs = Array.from(
			{ length: clampedFlockCount },
			() => tribeConfig,
		);
		return {
			tribeConfigs,
			boidCount: Math.min(
				Math.max(ranges.boidCount.min, Math.round(boidCount)),
				ranges.boidCount.max,
			),
			separationWeight: Math.min(
				Math.max(ranges.separationWeight.min, separationWeight),
				ranges.separationWeight.max,
			),
			alignmentWeight: Math.min(
				Math.max(ranges.alignmentWeight.min, alignmentWeight),
				ranges.alignmentWeight.max,
			),
			cohesionWeight: Math.min(
				Math.max(ranges.cohesionWeight.min, cohesionWeight),
				ranges.cohesionWeight.max,
			),
			maxDurationSeconds: Math.min(
				Math.max(ranges.maxDurationSeconds.min, maxDurationSeconds),
				ranges.maxDurationSeconds.max,
			),
			// Also clamped against the admin-configured combined FR-018
			// boid+predator object-count cap, same as server-side.
			predatorCount: Math.min(
				Math.max(ranges.predatorCount.min, Math.round(predatorCount)),
				ranges.predatorCount.max,
				maxObjectCount,
			),
			protectionThreshold: Math.min(
				Math.max(
					ranges.protectionThreshold.min,
					Math.round(protectionThreshold),
				),
				ranges.protectionThreshold.max,
			),
			foodStockInitial: Math.min(
				Math.max(ranges.foodStockInitial.min, foodStockInitial),
				ranges.foodStockInitial.max,
			),
			foodRegenRate: Math.min(
				Math.max(ranges.foodRegenRate.min, foodRegenRate),
				ranges.foodRegenRate.max,
			),
			flockCount: clampedFlockCount,
			crossbreedingEnabled,
			energyThreshold: Math.min(
				Math.max(ranges.energyThreshold.min, energyThreshold),
				ranges.energyThreshold.max,
			),
			mutationChance: Math.min(
				Math.max(ranges.mutationChance.min, mutationChance),
				ranges.mutationChance.max,
			),
			mutationMagnitude: Math.min(
				Math.max(ranges.mutationMagnitude.min, mutationMagnitude),
				ranges.mutationMagnitude.max,
			),
			xyArea: Math.min(
				Math.max(ranges.xyArea.min, Math.round(xyArea)),
				ranges.xyArea.max,
			),
			zDepth: Math.min(
				Math.max(ranges.zDepth.min, Math.round(zDepth)),
				ranges.zDepth.max,
			),
		};
	}

	const startServerMutation = api.simulation.startServer.useMutation({
		onSuccess: (data) => {
			// View the run just started immediately, rather than waiting for
			// the list's next 2s poll to pick it up.
			setViewingRunId(data.runId);
		},
		onError: (error) => {
			console.error(`simulation.startServer failed: ${error.message}`, error);
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
				// Use the clamped tribeConfigs actually sent to the server
				// (buildStartInput's bridge value), not the raw form state —
				// same "server-accepted value, not raw form state" rule this
				// block already follows for every other field below.
				tribeConfigs: variables.tribeConfigs,
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
				xyArea: variables.xyArea,
				zDepth: variables.zDepth,
			});
		},
		onError: (error) => {
			console.error(`simulation.start failed: ${error.message}`, error);
		},
	});

	const isRunListsLoading =
		runningRunsQuery.isPending || savedRunsQuery.isPending;

	return (
		<div className="from-primary to-background text-foreground flex min-h-screen flex-col items-center justify-center gap-8 bg-gradient-to-b p-8">
			<h1 className="text-3xl font-bold">Flocking Simulation</h1>

			{isRunListsLoading ? (
				<Skeleton className="h-16 w-full max-w-xs rounded-2xl" />
			) : null}

			{viewingRunId ? (
				<ServerRunViewer
					// S-24 Phase 2: the viewed run's own configured world size, from
					// `listRunning`'s per-run config — falls back to the admin
					// default only for the brief window before that list has
					// loaded/included this run (e.g. right after starting it).
					key={viewingRunId}
					onClose={() => setViewingRunId(null)}
					runId={viewingRunId}
					xyArea={
						runningRunsQuery.data?.find((run) => run.id === viewingRunId)
							?.xyArea ?? ranges.xyArea.default
					}
					zDepth={
						runningRunsQuery.data?.find((run) => run.id === viewingRunId)
							?.zDepth ?? ranges.zDepth.default
					}
				/>
			) : null}

			{runningRunsQuery.data && runningRunsQuery.data.length > 0 ? (
				<div className="bg-input text-foreground flex w-full max-w-xs flex-col items-center gap-2 rounded-2xl px-4 py-3 text-center">
					<p>
						Running on server — it keeps running even if you close this tab.
					</p>
					<div className="flex flex-wrap justify-center gap-2">
						{runningRunsQuery.data.map((run) => (
							<div className="flex items-center gap-1" key={run.id}>
								<Button
									className={
										run.id === viewingRunId
											? "bg-foreground/35 text-foreground h-auto rounded-full px-6 py-2 font-semibold"
											: "bg-background text-foreground hover:bg-foreground/15 h-auto rounded-full px-6 py-2 font-semibold"
									}
									onClick={() => setViewingRunId(run.id)}
									type="button"
								>
									Run #{run.id}
								</Button>
								<Button
									className="bg-background text-foreground hover:bg-foreground/15 h-auto rounded-full px-4 py-2 text-sm font-semibold"
									disabled={savePauseMutation.isPending}
									onClick={() => savePauseMutation.mutate({ runId: run.id })}
									type="button"
								>
									Save &amp; Pause
								</Button>
							</div>
						))}
					</div>
					{savePauseMutation.error ? (
						<p className="text-destructive">
							{savePauseMutation.error.message}
						</p>
					) : null}
				</div>
			) : null}

			{savedRunsQuery.data && savedRunsQuery.data.length > 0 ? (
				<div className="bg-input text-foreground flex w-full max-w-xs flex-col items-center gap-2 rounded-2xl px-4 py-3 text-center">
					<p>Saved — paused and ready to resume.</p>
					<div className="flex flex-wrap justify-center gap-2">
						{savedRunsQuery.data.map((run) => (
							<Button
								className="bg-background text-foreground hover:bg-foreground/15 h-auto rounded-full px-6 py-2 font-semibold"
								disabled={resumeMutation.isPending}
								key={run.id}
								onClick={() => resumeMutation.mutate({ runId: run.id })}
								type="button"
							>
								Resume Run #{run.id}
							</Button>
						))}
					</div>
					{resumeMutation.error ? (
						<p className="text-destructive">{resumeMutation.error.message}</p>
					) : null}
				</div>
			) : null}

			{suggestionQuery.data ? (
				<section className="bg-input text-foreground flex w-full max-w-xs flex-col gap-2 rounded-2xl px-4 py-3 text-center">
					<h2 className="font-semibold">Suggestion</h2>
					{suggestionQuery.data.status === "ok" ? (
						<>
							<p>{suggestionQuery.data.rationale}</p>
							<span className="bg-background self-center rounded-full px-3 py-1 text-sm font-semibold">
								Confidence: {suggestionQuery.data.confidence}
							</span>
						</>
					) : (
						<p>
							Not enough data yet — run a few more simulations with varied
							parameters to get a suggestion.
						</p>
					)}
				</section>
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
					tribeConfigs={activeRun.tribeConfigs}
					xyArea={activeRun.xyArea}
					zDepth={activeRun.zDepth}
				/>
			) : (
				<form
					className="flex w-full max-w-xs flex-col gap-3"
					onSubmit={(e) => {
						e.preventDefault();
						startRun.mutate(buildStartInput());
					}}
				>
					<NumberField
						id="boid-count"
						label={`Boid count (${ranges.boidCount.min}-${ranges.boidCount.max})`}
						max={ranges.boidCount.max}
						min={ranges.boidCount.min}
						onChange={setBoidCount}
						value={boidCount}
					/>
					<NumberField
						id="separation-weight"
						label="Separation weight"
						max={ranges.separationWeight.max}
						min={ranges.separationWeight.min}
						onChange={setSeparationWeight}
						step="0.1"
						value={separationWeight}
					/>
					<NumberField
						id="alignment-weight"
						label="Alignment weight"
						max={ranges.alignmentWeight.max}
						min={ranges.alignmentWeight.min}
						onChange={setAlignmentWeight}
						step="0.1"
						value={alignmentWeight}
					/>
					<NumberField
						id="cohesion-weight"
						label="Cohesion weight"
						max={ranges.cohesionWeight.max}
						min={ranges.cohesionWeight.min}
						onChange={setCohesionWeight}
						step="0.1"
						value={cohesionWeight}
					/>
					<NumberField
						id="max-duration-seconds"
						label="Max duration (seconds)"
						max={ranges.maxDurationSeconds.max}
						min={ranges.maxDurationSeconds.min}
						onChange={setMaxDurationSeconds}
						value={maxDurationSeconds}
					/>
					<NumberField
						id="predator-count"
						label={`Predator count (${ranges.predatorCount.min}-${ranges.predatorCount.max})`}
						max={ranges.predatorCount.max}
						min={ranges.predatorCount.min}
						onChange={setPredatorCount}
						value={predatorCount}
					/>
					<NumberField
						id="protection-threshold"
						label={`Protection threshold (${ranges.protectionThreshold.min}-${ranges.protectionThreshold.max})`}
						max={ranges.protectionThreshold.max}
						min={ranges.protectionThreshold.min}
						onChange={setProtectionThreshold}
						value={protectionThreshold}
					/>
					<NumberField
						id="food-stock-initial"
						label="Initial food stock"
						max={ranges.foodStockInitial.max}
						min={ranges.foodStockInitial.min}
						onChange={setFoodStockInitial}
						step="0.1"
						value={foodStockInitial}
					/>
					<NumberField
						id="food-regen-rate"
						label="Food regen rate"
						max={ranges.foodRegenRate.max}
						min={ranges.foodRegenRate.min}
						onChange={setFoodRegenRate}
						step="0.1"
						value={foodRegenRate}
					/>
					<NumberField
						id="flock-count"
						label={`Flock count (${ranges.flockCount.min}-${ranges.flockCount.max})`}
						max={ranges.flockCount.max}
						min={ranges.flockCount.min}
						onChange={setFlockCount}
						value={flockCount}
					/>
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
					<NumberField
						id="energy-threshold"
						label="Energy threshold"
						max={ranges.energyThreshold.max}
						min={ranges.energyThreshold.min}
						onChange={setEnergyThreshold}
						step="1"
						value={energyThreshold}
					/>
					<NumberField
						id="mutation-chance"
						label="Mutation chance"
						max={ranges.mutationChance.max}
						min={ranges.mutationChance.min}
						onChange={setMutationChance}
						step="0.05"
						value={mutationChance}
					/>
					<NumberField
						id="mutation-magnitude"
						label="Mutation magnitude"
						max={ranges.mutationMagnitude.max}
						min={ranges.mutationMagnitude.min}
						onChange={setMutationMagnitude}
						step="0.05"
						value={mutationMagnitude}
					/>
					<NumberField
						id="xy-area"
						label={`Area size (${ranges.xyArea.min}-${ranges.xyArea.max})`}
						max={ranges.xyArea.max}
						min={ranges.xyArea.min}
						onChange={setXyArea}
						value={xyArea}
					/>
					<NumberField
						id="z-depth"
						label={`Depth size (${ranges.zDepth.min}-${ranges.zDepth.max})`}
						max={ranges.zDepth.max}
						min={ranges.zDepth.min}
						onChange={setZDepth}
						value={zDepth}
					/>
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
		</div>
	);
}
