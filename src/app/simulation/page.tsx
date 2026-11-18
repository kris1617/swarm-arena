"use client";

import { useEffect, useRef, useState } from "react";
import { ServerRunViewer } from "~/app/simulation/_components/server-run-viewer";
import { SimulationCanvas } from "~/app/simulation/_components/simulation-canvas";
import { Button } from "~/components/ui/button";
import { NumberField } from "~/components/ui/number-field";
import { Skeleton } from "~/components/ui/skeleton";
import { Switch } from "~/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
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

// per-tribe-behavior-weights Phase 8: default per-tribe values for the
// tabbed form below. Tribes 0-2 are ported from the Lua reference's own
// three named tribes (`/mnt/Kids/boids_final/game/src/config.lua`,
// `ConfigData.tribes[1..3]`) — Lua stores its five perception radii SQUARED
// (`...PerceptionSq`), so each is square-rooted here to match this
// codebase's plain (non-squared) `TribeConfig` radius fields. Lua's
// `aliPerceptionSq`/`cohPerceptionSq` are two separate radii, but this
// codebase has only one shared `neighborRadius` for both alignment and
// cohesion (confirmed in boids.ts: both read off the same
// `tribeConfig.neighborRadius`) — averaged (then sqrt'd per-term before
// averaging) rather than picking one arbitrarily. `separationRadius` is
// ported from `sepPerceptionSq` (the separation-steering perception range),
// not `hardSepRadiusSq` (a much tighter, unrelated "hard" radius this
// codebase has no equivalent slot for). Lua's `sepMult`/`aliMult`/
// `cohMult` have no direct equivalent (this codebase's `separation`/
// `alignment`/`cohesion` ARE the full weight values, not a base-weight ×
// multiplier split, per the plan's own note) — used directly as the
// per-tribe weight values here, since they are themselves varied,
// reasonable per-tribe multiplier-shaped numbers. Tribe 3 (shown only when
// flockCount=4) has no Lua counterpart — its values are this
// implementer's own call, interpolated to stay in the same spirit/range as
// tribes 0-2.
const DEFAULT_TRIBE_CONFIGS: readonly TribeConfig[] = [
	{
		// Lua tribe 1 ("Green"): maxSpeed 150, minSpeed 20.
		separation: 1.5,
		alignment: 1.0,
		cohesion: 1.0,
		maxSpeed: 150,
		minSpeed: 20,
		matePreference: 1.0,
		neighborRadius: 100, // sqrt(aliPerceptionSq=100^2) == sqrt(cohPerceptionSq=100^2)
		separationRadius: 50, // sqrt(sepPerceptionSq=50^2)
		predatorDetectionRadius: 150, // sqrt(predPerceptionSq=150^2)
		burstMult: 1.5,
		burstCostMult: 3.0,
		// per-tribe-food-config Phase 1: matches the shared admin-range
		// default (parameter-ranges.ts) — not yet wired into the engine.
		foodStockShare: 50,
		foodRegenShare: 5,
		foodConsumptionRate: 0.5,
	},
	{
		// Lua tribe 2 ("Blue"): maxSpeed 120, minSpeed 15.
		separation: 1.2,
		alignment: 1.5,
		cohesion: 1.2,
		maxSpeed: 120,
		minSpeed: 15,
		matePreference: 1.0,
		neighborRadius: 100, // avg(sqrt(80^2)=80, sqrt(120^2)=120)
		separationRadius: 60, // sqrt(sepPerceptionSq=60^2)
		predatorDetectionRadius: 100, // sqrt(predPerceptionSq=100^2)
		burstMult: 1.5,
		burstCostMult: 3.0,
		foodStockShare: 50,
		foodRegenShare: 5,
		foodConsumptionRate: 0.5,
	},
	{
		// Lua tribe 3 ("Purple"): maxSpeed 170, minSpeed 25.
		separation: 1.4,
		alignment: 1.2,
		cohesion: 1.0,
		maxSpeed: 170,
		minSpeed: 25,
		matePreference: 1.0,
		neighborRadius: 90, // sqrt(aliPerceptionSq=90^2) == sqrt(cohPerceptionSq=90^2)
		separationRadius: 70, // sqrt(sepPerceptionSq=70^2)
		predatorDetectionRadius: 120, // sqrt(predPerceptionSq=120^2)
		burstMult: 1.6,
		burstCostMult: 3.5,
		foodStockShare: 50,
		foodRegenShare: 5,
		foodConsumptionRate: 0.5,
	},
	{
		// Tribe 4: no Lua counterpart — implementer's own default,
		// interpolated between tribes 0-2 above to stay in the same spirit.
		separation: 1.3,
		alignment: 1.3,
		cohesion: 1.1,
		maxSpeed: 140,
		minSpeed: 18,
		matePreference: 1.0,
		neighborRadius: 95,
		separationRadius: 55,
		predatorDetectionRadius: 110,
		burstMult: 1.55,
		burstCostMult: 3.2,
		foodStockShare: 50,
		foodRegenShare: 5,
		foodConsumptionRate: 0.5,
	},
];

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
	// per-tribe-behavior-weights Phase 8: one TribeConfig per tribe index
	// (0-3), replacing buildStartInput's Phase 1 uniform bridge value below.
	// All 4 entries stay alive in state regardless of the current
	// `flockCount` — lowering flockCount to 2 only hides tabs 3/4's inputs,
	// it never discards their values, so raising it back up restores them.
	const [tribeConfigs, setTribeConfigs] = useState<TribeConfig[]>(() =>
		DEFAULT_TRIBE_CONFIGS.map((config) => ({ ...config })),
	);
	function updateTribeField(
		index: number,
		field: keyof TribeConfig,
		value: number,
	) {
		setTribeConfigs((prev) =>
			prev.map((config, i) =>
				i === index ? { ...config, [field]: value } : config,
			),
		);
	}
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
		// per-tribe-behavior-weights Phase 8: the real per-tab tribeConfigs,
		// replacing Phase 1's uniform bridge value — one clamped TribeConfig
		// per tribe, sliced to the clamped flock count and taken from this
		// form's own per-tribe state (the tabs below), not a single shared
		// value.
		const tribeConfigsOutput = tribeConfigs
			.slice(0, clampedFlockCount)
			.map((tribeConfig) => ({
				separation: Math.min(
					Math.max(ranges.separationWeight.min, tribeConfig.separation),
					ranges.separationWeight.max,
				),
				alignment: Math.min(
					Math.max(ranges.alignmentWeight.min, tribeConfig.alignment),
					ranges.alignmentWeight.max,
				),
				cohesion: Math.min(
					Math.max(ranges.cohesionWeight.min, tribeConfig.cohesion),
					ranges.cohesionWeight.max,
				),
				maxSpeed: tribeConfig.maxSpeed,
				minSpeed: tribeConfig.minSpeed,
				matePreference: Math.min(
					Math.max(ranges.matePreference.min, tribeConfig.matePreference),
					ranges.matePreference.max,
				),
				neighborRadius: Math.min(
					Math.max(ranges.neighborRadius.min, tribeConfig.neighborRadius),
					ranges.neighborRadius.max,
				),
				separationRadius: Math.min(
					Math.max(ranges.separationRadius.min, tribeConfig.separationRadius),
					ranges.separationRadius.max,
				),
				predatorDetectionRadius: Math.min(
					Math.max(
						ranges.predatorDetectionRadius.min,
						tribeConfig.predatorDetectionRadius,
					),
					ranges.predatorDetectionRadius.max,
				),
				burstMult: Math.min(
					Math.max(ranges.burstMult.min, tribeConfig.burstMult),
					ranges.burstMult.max,
				),
				burstCostMult: Math.min(
					Math.max(ranges.burstCostMult.min, tribeConfig.burstCostMult),
					ranges.burstCostMult.max,
				),
				foodStockShare: Math.min(
					Math.max(ranges.foodStockShare.min, tribeConfig.foodStockShare),
					ranges.foodStockShare.max,
				),
				foodRegenShare: Math.min(
					Math.max(ranges.foodRegenShare.min, tribeConfig.foodRegenShare),
					ranges.foodRegenShare.max,
				),
				foodConsumptionRate: Math.min(
					Math.max(
						ranges.foodConsumptionRate.min,
						tribeConfig.foodConsumptionRate,
					),
					ranges.foodConsumptionRate.max,
				),
			}));
		// predator-tribe-concept Phase 1: a single uniform bridge value, same
		// posture as per-tribe-behavior-weights Phase 1's own
		// pre-per-tab-UI bridge for boids' tribeConfigs — predators get their
		// own fully independent tribe-count/tribe-config pair, but no
		// per-tab predator UI exists yet (that's a later phase), so this
		// pins predatorFlockCount at 1 with one default-valued
		// PredatorTribeConfig, reproducing today's effective
		// single-undifferentiated-predator-tribe behavior exactly.
		const predatorTribeConfigsOutput = [
			{
				separation: ranges.separationWeight.default,
				alignment: ranges.alignmentWeight.default,
				cohesion: ranges.cohesionWeight.default,
				// Mirrors boids.ts's own fixed PREDATOR_MAX_SPEED/PREDATOR_MIN_SPEED
				// engine constants (55/20) — there is no admin range for predator
				// cruise speed yet, and these fields stay behaviorally inert for
				// predators this phase regardless (see PredatorTribeConfig's own
				// comment in boids.ts).
				maxSpeed: 55,
				minSpeed: 20,
				matePreference: ranges.matePreference.default,
				detectionRadius: ranges.detectionRadius.default,
				captureRadiusMult: ranges.captureRadiusMult.default,
			},
		];
		return {
			tribeConfigs: tribeConfigsOutput,
			predatorFlockCount: 1,
			predatorTribeConfigs: predatorTribeConfigsOutput,
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
				// (buildStartInput's per-tab output), not the raw form state —
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

	// per-tribe-behavior-weights Phase 8: how many tribe tabs to render —
	// same clamp buildStartInput applies to flockCount, so the tab strip
	// always matches what will actually be submitted.
	const visibleTribeCount = Math.min(
		Math.max(ranges.flockCount.min, Math.round(flockCount)),
		ranges.flockCount.max,
	);
	// One row per TribeConfig field, driving both the field's NumberField
	// bounds (reusing the same admin ranges buildStartInput clamps against)
	// and its onChange wiring — avoids hand-duplicating 11 NumberFields x 4
	// tribes below.
	const tribeFieldDefs: {
		field: keyof TribeConfig;
		label: string;
		min: number;
		max: number;
		step: string;
	}[] = [
		{
			field: "separation",
			label: "Separation weight",
			min: ranges.separationWeight.min,
			max: ranges.separationWeight.max,
			step: "0.1",
		},
		{
			field: "alignment",
			label: "Alignment weight",
			min: ranges.alignmentWeight.min,
			max: ranges.alignmentWeight.max,
			step: "0.1",
		},
		{
			field: "cohesion",
			label: "Cohesion weight",
			min: ranges.cohesionWeight.min,
			max: ranges.cohesionWeight.max,
			step: "0.1",
		},
		// maxSpeed/minSpeed have no admin-configured range (tribeConfigSchema
		// only requires them finite, per simulation.ts) — fixed, generous
		// bounds matching the Lua reference's own speed scale (predator
		// maxSpeed 280 is the highest value anywhere in that file).
		{ field: "maxSpeed", label: "Max speed", min: 1, max: 300, step: "1" },
		{ field: "minSpeed", label: "Min speed", min: 0, max: 300, step: "1" },
		{
			field: "matePreference",
			label: "Mate preference",
			min: ranges.matePreference.min,
			max: ranges.matePreference.max,
			step: "0.05",
		},
		{
			field: "neighborRadius",
			label: "Neighbor radius",
			min: ranges.neighborRadius.min,
			max: ranges.neighborRadius.max,
			step: "1",
		},
		{
			field: "separationRadius",
			label: "Separation radius",
			min: ranges.separationRadius.min,
			max: ranges.separationRadius.max,
			step: "1",
		},
		{
			field: "predatorDetectionRadius",
			label: "Predator detection radius",
			min: ranges.predatorDetectionRadius.min,
			max: ranges.predatorDetectionRadius.max,
			step: "1",
		},
		{
			field: "burstMult",
			label: "Burst multiplier",
			min: ranges.burstMult.min,
			max: ranges.burstMult.max,
			step: "0.1",
		},
		{
			field: "burstCostMult",
			label: "Burst cost multiplier",
			min: ranges.burstCostMult.min,
			max: ranges.burstCostMult.max,
			step: "0.1",
		},
		{
			field: "foodStockShare",
			label: "Food stock share",
			min: ranges.foodStockShare.min,
			max: ranges.foodStockShare.max,
			step: "1",
		},
		{
			field: "foodRegenShare",
			label: "Food regen share",
			min: ranges.foodRegenShare.min,
			max: ranges.foodRegenShare.max,
			step: "0.1",
		},
		{
			field: "foodConsumptionRate",
			label: "Food consumption rate",
			min: ranges.foodConsumptionRate.min,
			max: ranges.foodConsumptionRate.max,
			step: "0.1",
		},
	];

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
					<div className="flex flex-col gap-2">
						<p className="font-semibold">Per-tribe configuration</p>
						<Tabs defaultValue="0">
							<TabsList>
								{Array.from({ length: visibleTribeCount }, (_, i) => (
									// biome-ignore lint/suspicious/noArrayIndexKey: tribe index IS the stable identity here — tribeConfigs is a fixed 4-slot array (never reordered/filtered), and this index is also the array position read back in tribeConfigs[i] below.
									<TabsTrigger key={i} value={String(i)}>
										Tribe {i + 1}
									</TabsTrigger>
								))}
							</TabsList>
							{Array.from({ length: visibleTribeCount }, (_, i) => {
								const tribeConfig = tribeConfigs[i];
								if (!tribeConfig) {
									return null;
								}
								return (
									<TabsContent
										className="flex flex-col gap-3"
										// biome-ignore lint/suspicious/noArrayIndexKey: tribe index IS the stable identity here — tribeConfigs is a fixed 4-slot array (never reordered/filtered), and this index is also the array position read via tribeConfigs[i] above.
										key={i}
										value={String(i)}
									>
										{tribeFieldDefs.map((def) => (
											<NumberField
												id={`tribe-${i}-${def.field}`}
												key={def.field}
												label={def.label}
												max={def.max}
												min={def.min}
												onChange={(value) =>
													updateTribeField(i, def.field, value)
												}
												step={def.step}
												value={tribeConfig[def.field]}
											/>
										))}
									</TabsContent>
								);
							})}
						</Tabs>
					</div>
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
