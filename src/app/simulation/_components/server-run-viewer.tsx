"use client";

import { cn } from "cn";
import { useMemo, useRef, useState } from "react";

import {
	resolveCameraForFrame,
	type WorldSize,
} from "~/app/simulation/_components/camera";
import {
	BOID_LENGTH,
	CANVAS_HEIGHT,
	CANVAS_WIDTH,
	drawMinimap,
	drawScene,
	drawWorldBoundary,
	MINIMAP_HEIGHT,
	MINIMAP_WIDTH,
} from "~/app/simulation/_components/simulation-canvas";
import { useCamera } from "~/app/simulation/_components/use-camera";
import { Button } from "~/components/ui/button";
import { NumberField } from "~/components/ui/number-field";
import { Switch } from "~/components/ui/switch";
import type {
	BoidState,
	PredatorState,
	PredatorTribeConfig,
	TribeConfig,
} from "~/server/simulation/boids";
import {
	DEFAULT_PARAMETER_RANGES,
	type ParameterRanges,
} from "~/server/simulation/parameter-ranges";
import type { LiveAdjustableParams } from "~/server/simulation/server-run-registry";
import { api } from "~/trpc/react";

// live-parameter-adjustment (S-27) Phase 2: the 5 fields `LiveAdjustableParams`
// carries, kept as a local tuple (rather than `Object.keys` on a value) so
// iteration order is stable and `satisfies` catches drift if the server-side
// type ever adds/removes a field.
const LIVE_FIELDS = [
	"foodRegenRate",
	"protectionThreshold",
	"energyThreshold",
	"mutationChance",
	"mutationMagnitude",
] as const satisfies readonly (keyof LiveAdjustableParams)[];

type LiveField = (typeof LIVE_FIELDS)[number];

type LiveFormValues = Record<LiveField, number>;

const LIVE_FIELD_LABELS: Record<LiveField, string> = {
	foodRegenRate: "Food regen rate",
	protectionThreshold: "Protection threshold",
	energyThreshold: "Energy threshold",
	mutationChance: "Mutation chance",
	mutationMagnitude: "Mutation magnitude",
};

// live-parameter-adjustment (S-27) Phase 2: the panel groups the 5 fields by
// when a change actually takes effect, so a user isn't confused about why
// the offspring-only fields don't visibly do anything until the next birth.
const IMMEDIATE_FIELDS = [
	"foodRegenRate",
	"protectionThreshold",
] as const satisfies readonly LiveField[];

const FUTURE_OFFSPRING_FIELDS = [
	"energyThreshold",
	"mutationChance",
	"mutationMagnitude",
] as const satisfies readonly LiveField[];

// How long the Apply button stays disabled after a successful apply
// (decision 6 in plan.md's Overview — client-side only, no server throttle).
const APPLY_COOLDOWN_MS = 500;

// How long a successfully-applied field keeps its success-flash styling.
const FLASH_DURATION_MS = 1000;

// per-tribe-predator-config Phase 5: the per-tribe live-edit panel's field
// shape — mirrors page.tsx's `tribeFieldDefs`/`predatorTribeFieldDefs`
// exactly (same field set, same exclusion of `crossbreedingEnabled`, which
// is rendered separately as a Switch), duplicated here rather than shared
// since page.tsx's definitions are local `const`s inside its own component,
// not exported — same posture as this file's own `LIVE_FIELD_LABELS` being
// a local duplicate of concepts defined elsewhere.
type TribeFieldDef<T> = {
	field: Exclude<keyof T, "crossbreedingEnabled">;
	label: string;
	min: number;
	max: number;
	step: string;
};

function buildBoidTribeFieldDefs(
	ranges: ParameterRanges,
): TribeFieldDef<TribeConfig>[] {
	return [
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
		// maxSpeed/minSpeed have no admin-configured range for boids (same gap
		// page.tsx's own tribeFieldDefs documents) — fixed, generous bounds
		// matching that same fallback.
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
}

// per-tribe-predator-config Phase 5: predator-side sibling of
// `buildBoidTribeFieldDefs` — only the 5 non-inert `PredatorTribeConfig`
// fields (separation/alignment/cohesion stay on the type but are not
// rendered, per plan.md's "What We're NOT Doing"), mirroring page.tsx's
// `predatorTribeFieldDefs` exactly.
function buildPredatorTribeFieldDefs(
	ranges: ParameterRanges,
): TribeFieldDef<PredatorTribeConfig>[] {
	return [
		{
			field: "maxSpeed",
			label: "Max speed",
			min: ranges.maxSpeed.min,
			max: ranges.maxSpeed.max,
			step: "1",
		},
		{
			field: "minSpeed",
			label: "Min speed",
			min: ranges.minSpeed.min,
			max: ranges.minSpeed.max,
			step: "1",
		},
		{
			field: "matePreference",
			label: "Mate preference",
			min: ranges.matePreference.min,
			max: ranges.matePreference.max,
			step: "0.05",
		},
		{
			field: "detectionRadius",
			label: "Detection radius",
			min: ranges.detectionRadius.min,
			max: ranges.detectionRadius.max,
			step: "1",
		},
		{
			field: "captureRadiusMult",
			label: "Capture radius multiplier",
			min: ranges.captureRadiusMult.min,
			max: ranges.captureRadiusMult.max,
			step: "0.1",
		},
	];
}

type ServerRunViewerProps = {
	runId: number;
	// S-24 Phase 2: the viewed run's configured spatial extent — needed so
	// the camera's zoom limits (camera.ts's computeMinZoom) are derived from
	// the run's real world size rather than a hardcoded 200. Page.tsx (the
	// only caller) sources these from `listRunning`'s per-run config.
	xyArea: number;
	zDepth: number;
	onClose: () => void;
};

// Renders a server-run simulation's live tick state from F-04's SSE
// subscription alone — no local tick loop, no ownership of execution.
// Closing this component only unsubscribes; it never affects the
// underlying run.
export function ServerRunViewer({
	runId,
	xyArea,
	zDepth,
	onClose,
}: ServerRunViewerProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const [viewError, setViewError] = useState<string | null>(null);
	// Fixed for this component instance's lifetime — page.tsx keys this
	// component by runId (see its `key={viewingRunId}`), so a new viewed run
	// always gets a fresh instance (and thus a fresh camera/worldSize) rather
	// than carrying stale state forward.
	const worldSize: WorldSize = { x: xyArea, y: xyArea, z: zDepth };
	// The most recent snapshot pushed over the subscription, kept so pan/
	// zoom/resize input between pushes (useCamera's onChange) can redraw
	// against real data instead of waiting for the next ~150ms push.
	const lastSnapshotRef = useRef<{
		boids: BoidState[];
		predators: PredatorState[];
	} | null>(null);
	// live-boid-count-adjustment Phase 3: current boid/predator counts for the
	// population step-button control, read off the same ~150ms subscription
	// push `lastSnapshotRef` already receives — no new snapshot field needed.
	const [liveCounts, setLiveCounts] = useState<{
		boids: number;
		predators: number;
	} | null>(null);

	const { cameraRef, sizeRef, recenter } = useCamera({
		boidLength: BOID_LENGTH,
		canvasRef,
		defaultSize: { width: CANVAS_WIDTH, height: CANVAS_HEIGHT },
		onChange: () => redraw(),
		worldSize,
	});

	// S-24 Phase 3: minimap/boundary toggles — same ref-plus-state posture as
	// simulation-canvas.tsx's identical toggles, and for the same reason:
	// `redraw` here is captured once by useCamera's own effect (its
	// onChange), so the visibility it draws against must come from a ref,
	// not from `showMinimap`/`showBoundary` state directly.
	const minimapCanvasRef = useRef<HTMLCanvasElement>(null);
	const showMinimapRef = useRef(true);
	const showBoundaryRef = useRef(true);
	const [showMinimap, setShowMinimap] = useState(true);
	const [showBoundary, setShowBoundary] = useState(true);

	function handleToggleMinimap(checked: boolean) {
		showMinimapRef.current = checked;
		setShowMinimap(checked);
		redraw();
	}

	function handleToggleBoundary(checked: boolean) {
		showBoundaryRef.current = checked;
		setShowBoundary(checked);
		redraw();
	}

	// live-parameter-adjustment (S-27) Phase 2: the live-edit panel's form
	// state. `null` until the first subscription push arrives (no values to
	// pre-fill from yet).
	const [liveValues, setLiveValues] = useState<LiveFormValues | null>(null);
	// Per-field dirtiness: true once the user has typed into a field since its
	// value was last confirmed to match the server (initial sync or a
	// successful apply). A dirty field is never overwritten by a later
	// subscription push — see `syncLiveParams` below.
	const dirtyFieldsRef = useRef<Partial<Record<LiveField, boolean>>>({});
	// The last value we know the server actually holds for each field —
	// updated by non-dirty subscription pushes and by a successful apply.
	// Used only to compute the batch patch on Apply (diff against this, not
	// against the full form), so Apply never re-sends a field the user didn't
	// touch.
	const appliedValuesRef = useRef<LiveFormValues | null>(null);
	const [warnings, setWarnings] = useState<string[]>([]);
	const [flashFields, setFlashFields] = useState<ReadonlySet<LiveField>>(
		new Set(),
	);
	const [applyCooldown, setApplyCooldown] = useState(false);
	// The exact patch most recently sent, read back in `onSuccess` (not
	// re-derived from `liveValues`, which may have moved on if the user kept
	// typing while the request was in flight).
	const pendingPatchRef = useRef<Partial<LiveFormValues>>({});

	// per-tribe-predator-config Phase 5: the per-tribe live-edit panel's own
	// state — a PARALLEL structure to `liveValues`/`LiveFormValues` above, not
	// a widening of it (an array of per-tribe objects doesn't fit
	// `Record<LiveField, number>`). `null` until the first subscription push
	// arrives, same as `liveValues`. Boid and predator tribes are tracked as
	// two independent arrays (and have two independent Apply buttons/
	// mutations below) since `updateTribeConfigs`/`updatePredatorTribeConfigs`
	// are two separate router procedures, each replacing only its own
	// species' array wholesale.
	const [boidTribeValues, setBoidTribeValues] = useState<TribeConfig[] | null>(
		null,
	);
	const [predatorTribeValues, setPredatorTribeValues] = useState<
		PredatorTribeConfig[] | null
	>(null);
	// Dirty cells across BOTH species, keyed `${species}:${tribeIndex}:${field}`
	// (field includes "crossbreedingEnabled") — one shared set, same posture as
	// the scalar panel's `dirtyFieldsRef`, since a dirty cell is never
	// overwritten by a later subscription push regardless of which species it
	// belongs to.
	const dirtyTribeFieldsRef = useRef<Set<string>>(new Set());
	const [flashBoidTribeKeys, setFlashBoidTribeKeys] = useState<
		ReadonlySet<string>
	>(new Set());
	const [flashPredatorTribeKeys, setFlashPredatorTribeKeys] = useState<
		ReadonlySet<string>
	>(new Set());
	const [boidTribeApplyCooldown, setBoidTribeApplyCooldown] = useState(false);
	const [predatorTribeApplyCooldown, setPredatorTribeApplyCooldown] =
		useState(false);
	const [tribeWarnings, setTribeWarnings] = useState<string[]>([]);
	// The dirty keys present at the moment Apply was clicked, read back in
	// `onSuccess` to clear exactly those cells and flash them — mirrors
	// `pendingPatchRef`'s "read back what was actually sent, not what the
	// form may have moved on to" rationale.
	const pendingBoidTribeKeysRef = useRef<string[]>([]);
	const pendingPredatorTribeKeysRef = useRef<string[]>([]);

	const rangesQuery = api.simulation.getParameterRanges.useQuery();
	const ranges = rangesQuery.data?.parameterRanges ?? DEFAULT_PARAMETER_RANGES;
	// impl-review F3: memoized so these ~13/~5-entry arrays aren't rebuilt on
	// every render (this component re-renders on each `watch` subscription
	// push) — only recomputed when `ranges` actually changes.
	const boidTribeFieldDefs = useMemo(
		() => buildBoidTribeFieldDefs(ranges),
		[ranges],
	);
	const predatorTribeFieldDefs = useMemo(
		() => buildPredatorTribeFieldDefs(ranges),
		[ranges],
	);

	// Shared by both species: on the first push, pre-fill everything; on later
	// pushes, only overwrite cells that aren't currently dirty — the exact
	// "first push pre-fills, later pushes only overwrite non-dirty cells"
	// logic `syncLiveParams` already uses for the scalar panel, keyed per
	// (species, tribeIndex, field) instead of per-field.
	function syncTribeArray<T extends Record<string, number | boolean>>(
		species: "boid" | "predator",
		data: T[],
		current: T[] | null,
	): T[] {
		if (!current) {
			return data.map((tribe) => ({ ...tribe }));
		}
		return data.map((tribe, index) => {
			const prevTribe = current[index];
			if (!prevTribe) {
				return { ...tribe };
			}
			const merged = { ...tribe };
			for (const key of Object.keys(tribe) as (keyof T)[]) {
				const dirtyKey = `${species}:${index}:${String(key)}`;
				if (dirtyTribeFieldsRef.current.has(dirtyKey)) {
					merged[key] = prevTribe[key];
				}
			}
			return merged;
		});
	}

	// impl-review F1: overloads give each call site a field type narrowed to
	// its own species' real keys (matching page.tsx's two-typed-setter
	// convention for this same split), so a typo'd field name fails to
	// compile instead of silently no-oping at runtime. The implementation
	// signature keeps a loose `field: string` only because one shared body
	// serves both branches below — every caller goes through an overload.
	function handleTribeFieldChange(
		species: "boid",
		index: number,
		field: Exclude<keyof TribeConfig, "crossbreedingEnabled">,
		value: number,
	): void;
	function handleTribeFieldChange(
		species: "predator",
		index: number,
		field: Exclude<keyof PredatorTribeConfig, "crossbreedingEnabled">,
		value: number,
	): void;
	function handleTribeFieldChange(
		species: "boid" | "predator",
		index: number,
		field: "crossbreedingEnabled",
		value: boolean,
	): void;
	function handleTribeFieldChange(
		species: "boid" | "predator",
		index: number,
		field: string,
		value: number | boolean,
	) {
		dirtyTribeFieldsRef.current.add(`${species}:${index}:${field}`);
		if (species === "boid") {
			setBoidTribeValues((current) =>
				current
					? current.map((tribe, i) =>
							i === index ? { ...tribe, [field]: value } : tribe,
						)
					: current,
			);
		} else {
			setPredatorTribeValues((current) =>
				current
					? current.map((tribe, i) =>
							i === index ? { ...tribe, [field]: value } : tribe,
						)
					: current,
			);
		}
	}

	const updateTribeConfigsMutation =
		api.simulation.updateTribeConfigs.useMutation({
			onSuccess: (data) => {
				for (const key of pendingBoidTribeKeysRef.current) {
					dirtyTribeFieldsRef.current.delete(key);
				}
				setTribeWarnings((current) => [
					...current.filter((w) => !w.startsWith("tribe ")),
					...data.warnings,
				]);
				setFlashBoidTribeKeys(new Set(pendingBoidTribeKeysRef.current));
				setTimeout(() => {
					setFlashBoidTribeKeys(new Set());
				}, FLASH_DURATION_MS);
				setBoidTribeApplyCooldown(true);
				setTimeout(() => {
					setBoidTribeApplyCooldown(false);
				}, APPLY_COOLDOWN_MS);
			},
			onError: (error) => {
				setViewError(error.message);
			},
		});

	const updatePredatorTribeConfigsMutation =
		api.simulation.updatePredatorTribeConfigs.useMutation({
			onSuccess: (data) => {
				for (const key of pendingPredatorTribeKeysRef.current) {
					dirtyTribeFieldsRef.current.delete(key);
				}
				setTribeWarnings((current) => [
					...current.filter((w) => !w.startsWith("predator tribe ")),
					...data.warnings,
				]);
				setFlashPredatorTribeKeys(new Set(pendingPredatorTribeKeysRef.current));
				setTimeout(() => {
					setFlashPredatorTribeKeys(new Set());
				}, FLASH_DURATION_MS);
				setPredatorTribeApplyCooldown(true);
				setTimeout(() => {
					setPredatorTribeApplyCooldown(false);
				}, APPLY_COOLDOWN_MS);
			},
			onError: (error) => {
				setViewError(error.message);
			},
		});

	// impl: Apply always sends the WHOLE current tribe-config array for that
	// species — the router's hard length-match check against the run's own
	// flockCount/predatorFlockCount requires it (see plan.md's Phase 5
	// "CRITICAL" note); a partial/single-tribe patch is not a valid payload.
	function handleApplyBoidTribes() {
		if (!boidTribeValues) {
			return;
		}
		pendingBoidTribeKeysRef.current = Array.from(
			dirtyTribeFieldsRef.current,
		).filter((key) => key.startsWith("boid:"));
		updateTribeConfigsMutation.mutate({
			runId,
			tribeConfigs: boidTribeValues,
		});
	}

	function handleApplyPredatorTribes() {
		if (!predatorTribeValues) {
			return;
		}
		pendingPredatorTribeKeysRef.current = Array.from(
			dirtyTribeFieldsRef.current,
		).filter((key) => key.startsWith("predator:"));
		updatePredatorTribeConfigsMutation.mutate({
			runId,
			predatorTribeConfigs: predatorTribeValues,
		});
	}

	function renderTribeField(
		species: "boid" | "predator",
		index: number,
		def: TribeFieldDef<TribeConfig> | TribeFieldDef<PredatorTribeConfig>,
		value: number,
	) {
		const key = `${species}:${index}:${String(def.field)}`;
		const flashed =
			species === "boid"
				? flashBoidTribeKeys.has(key)
				: flashPredatorTribeKeys.has(key);
		return (
			<div
				className={cn(
					"flex flex-col gap-1 rounded-xl transition-shadow",
					flashed ? "ring-chart-2 ring-2" : "",
				)}
				key={String(def.field)}
			>
				<NumberField
					id={`tribe-live-${species}-${index}-${String(def.field)}`}
					label={def.label}
					max={def.max}
					min={def.min}
					onChange={(v) => {
						// `species` and `def` are independently-typed params (not a
						// discriminated union), so narrowing `species` alone can't
						// narrow `def.field` for TS — this is the one documented
						// boundary cast impl-review F1 accepted, immediately after
						// the narrowing check that makes it actually safe at runtime.
						if (species === "boid") {
							handleTribeFieldChange(
								"boid",
								index,
								def.field as Exclude<keyof TribeConfig, "crossbreedingEnabled">,
								v,
							);
						} else {
							handleTribeFieldChange(
								"predator",
								index,
								def.field as Exclude<
									keyof PredatorTribeConfig,
									"crossbreedingEnabled"
								>,
								v,
							);
						}
					}}
					step={def.step}
					value={value}
				/>
			</div>
		);
	}

	function renderTribeCrossbreedingSwitch(
		species: "boid" | "predator",
		index: number,
		checked: boolean,
	) {
		const key = `${species}:${index}:crossbreedingEnabled`;
		const flashed =
			species === "boid"
				? flashBoidTribeKeys.has(key)
				: flashPredatorTribeKeys.has(key);
		const id = `tribe-live-${species}-${index}-crossbreedingEnabled`;
		return (
			<label
				className={cn(
					"flex items-center gap-2 rounded-xl text-sm transition-shadow",
					flashed ? "ring-chart-2 ring-2" : "",
				)}
				htmlFor={id}
			>
				Crossbreeding enabled
				<Switch
					checked={checked}
					id={id}
					onCheckedChange={(v) =>
						handleTribeFieldChange(species, index, "crossbreedingEnabled", v)
					}
				/>
			</label>
		);
	}

	// per-tribe-predator-config Phase 4: every remaining `LiveAdjustableParams`
	// field is a plain number now that `crossbreedingEnabled` moved to the
	// per-tribe array live-edit path — this is now a type-narrowing identity,
	// kept (rather than inlined) so `toLiveFormValues` reads the same either
	// way.
	function toFormFieldValue(value: LiveAdjustableParams[LiveField]): number {
		return value;
	}

	function toLiveFormValues(data: LiveAdjustableParams): LiveFormValues {
		const result = {} as LiveFormValues;
		for (const field of LIVE_FIELDS) {
			result[field] = toFormFieldValue(data[field]);
		}
		return result;
	}

	function syncLiveParams(data: LiveAdjustableParams) {
		if (!appliedValuesRef.current) {
			// First push: nothing to preserve yet, pre-fill every field.
			const initial = toLiveFormValues(data);
			appliedValuesRef.current = initial;
			setLiveValues(initial);
			return;
		}
		const applied = appliedValuesRef.current;
		setLiveValues((current) => {
			const next = current ? { ...current } : toLiveFormValues(data);
			for (const field of LIVE_FIELDS) {
				if (!dirtyFieldsRef.current[field]) {
					const value = toFormFieldValue(data[field]);
					next[field] = value;
					applied[field] = value;
				}
			}
			return next;
		});
	}

	function handleLiveFieldChange(field: LiveField, value: number) {
		dirtyFieldsRef.current[field] = true;
		setLiveValues((current) =>
			current ? { ...current, [field]: value } : current,
		);
	}

	const updateRunParamsMutation = api.simulation.updateRunParams.useMutation({
		onSuccess: (data) => {
			const patch = pendingPatchRef.current;
			const changedFields = Object.keys(patch) as LiveField[];
			const applied = appliedValuesRef.current;
			for (const field of changedFields) {
				const value = patch[field];
				if (value === undefined) {
					continue;
				}
				if (applied) {
					applied[field] = value;
				}
				dirtyFieldsRef.current[field] = false;
			}
			setWarnings(data.warnings);
			setFlashFields(new Set(changedFields));
			setTimeout(() => {
				setFlashFields(new Set());
			}, FLASH_DURATION_MS);
			setApplyCooldown(true);
			setTimeout(() => {
				setApplyCooldown(false);
			}, APPLY_COOLDOWN_MS);
		},
		onError: (error) => {
			// Reuse the same error surface the `watch` subscription already
			// uses (L47/155-157) rather than inventing a second
			// error-display mechanism — per plan.md's Phase 2 contract.
			setViewError(error.message);
		},
	});

	function handleApplyLiveParams() {
		if (!liveValues || !appliedValuesRef.current) {
			return;
		}
		const applied = appliedValuesRef.current;
		const patch: Partial<LiveFormValues> = {};
		for (const field of LIVE_FIELDS) {
			if (liveValues[field] !== applied[field]) {
				patch[field] = liveValues[field];
			}
		}
		if (Object.keys(patch).length === 0) {
			return;
		}
		pendingPatchRef.current = patch;
		updateRunParamsMutation.mutate({ runId, ...patch });
	}

	function warningsForField(field: LiveField): string[] {
		return warnings.filter((warning) => warning.startsWith(field));
	}

	// live-parameter-adjustment (S-27) Phase 2: shared per-field render used by
	// both grouped sub-sections below (`IMMEDIATE_FIELDS`/
	// `FUTURE_OFFSPRING_FIELDS`) — same NumberField/warning/flash rendering as
	// before the grouping split, just factored out so it isn't duplicated.
	// `values` is passed explicitly (rather than reading `liveValues` from the
	// closure) so callers only invoke this once `liveValues` is known non-null.
	function renderLiveField(field: LiveField, values: LiveFormValues) {
		const fieldWarnings = warningsForField(field);
		const fieldRange = DEFAULT_PARAMETER_RANGES[field];
		const step =
			field === "energyThreshold"
				? "1"
				: field === "protectionThreshold"
					? "1"
					: field === "mutationChance" || field === "mutationMagnitude"
						? "0.05"
						: "0.1";
		return (
			<div
				className={cn(
					"flex flex-col gap-1 rounded-xl transition-shadow",
					flashFields.has(field) ? "ring-chart-2 ring-2" : "",
				)}
				key={field}
			>
				<NumberField
					id={`live-param-${field}`}
					label={LIVE_FIELD_LABELS[field]}
					max={fieldRange.max}
					min={fieldRange.min}
					onChange={(value) => handleLiveFieldChange(field, value)}
					step={step}
					value={values[field]}
				/>
				{fieldWarnings.map((warning) => (
					<p className="text-destructive text-xs" key={warning}>
						{warning}
					</p>
				))}
			</div>
		);
	}

	function unmatchedWarnings(): string[] {
		return warnings.filter(
			(warning) => !LIVE_FIELDS.some((field) => warning.startsWith(field)),
		);
	}

	// live-boid-count-adjustment Phase 3: each click is a complete, immediate
	// action (no staging/dirty-tracking, unlike the LIVE_FIELDS Apply flow) —
	// mirrors S-29's client-staged Switch precedent. Cooldown/flash state is
	// scoped to these two controls specifically (not shared with
	// `applyCooldown`/`flashFields`, which belong to the batched scalar-field
	// Apply flow), and keyed per field (impl-review F1) so clicking boid's
	// buttons doesn't visibly disable/flash predator's row too.
	const [populationCooldownFields, setPopulationCooldownFields] = useState<
		ReadonlySet<"boidCount" | "predatorCount">
	>(new Set());
	const [flashPopulationFields, setFlashPopulationFields] = useState<
		ReadonlySet<"boidCount" | "predatorCount">
	>(new Set());

	const adjustPopulationMutation =
		api.simulation.adjustLivePopulation.useMutation({
			onSuccess: (data, variables) => {
				// `boidCount`/`predatorCount` aren't in `LIVE_FIELDS`, so these
				// warnings already fall through `unmatchedWarnings()` without any
				// change there; dedupe by prefix across repeated clicks the same
				// way `updateRunParamsMutation`'s onSuccess replaces its own
				// fields' prior warnings rather than accumulating stale ones.
				setWarnings((current) => [
					...current.filter((warning) => !warning.startsWith(variables.field)),
					...data.warnings,
				]);
				setFlashPopulationFields(new Set([variables.field]));
				setTimeout(() => {
					setFlashPopulationFields(new Set());
				}, FLASH_DURATION_MS);
				setPopulationCooldownFields((current) =>
					new Set(current).add(variables.field),
				);
				setTimeout(() => {
					setPopulationCooldownFields((current) => {
						const next = new Set(current);
						next.delete(variables.field);
						return next;
					});
				}, APPLY_COOLDOWN_MS);
			},
			onError: (error) => {
				// Reuse the same error surface the `watch` subscription and
				// `updateRunParamsMutation` already use, per the lessons.md rule
				// on a single error-display mechanism per component.
				setViewError(error.message);
			},
		});

	function handleAdjustPopulation(
		field: "boidCount" | "predatorCount",
		delta: number,
	) {
		adjustPopulationMutation.mutate({ runId, field, delta });
	}

	// live-boid-count-adjustment Phase 3: shared per-kind render for the
	// "current: N [-10] [+10]" rows, same ring-flash treatment
	// `renderLiveField` gives the scalar fields above.
	function renderPopulationControl(
		field: "boidCount" | "predatorCount",
		label: string,
		currentCount: number,
	) {
		return (
			<div
				className={cn(
					"flex items-center justify-between gap-2 rounded-xl transition-shadow",
					flashPopulationFields.has(field) ? "ring-chart-2 ring-2" : "",
				)}
				key={field}
			>
				<span className="text-foreground text-sm">
					{label}: current {currentCount}
				</span>
				<div className="flex gap-2">
					<Button
						className="bg-input text-foreground hover:bg-foreground/35 h-auto rounded-full px-3 py-1 text-xs font-semibold"
						disabled={
							(adjustPopulationMutation.isPending &&
								adjustPopulationMutation.variables?.field === field) ||
							populationCooldownFields.has(field)
						}
						onClick={() => handleAdjustPopulation(field, -10)}
						type="button"
					>
						-10
					</Button>
					<Button
						className="bg-input text-foreground hover:bg-foreground/35 h-auto rounded-full px-3 py-1 text-xs font-semibold"
						disabled={
							(adjustPopulationMutation.isPending &&
								adjustPopulationMutation.variables?.field === field) ||
							populationCooldownFields.has(field)
						}
						onClick={() => handleAdjustPopulation(field, 10)}
						type="button"
					>
						+10
					</Button>
				</div>
			</div>
		);
	}

	function redraw() {
		const snapshot = lastSnapshotRef.current;
		const ctx = canvasRef.current?.getContext("2d");
		if (!ctx || !snapshot) {
			return;
		}
		resolveCameraForFrame(
			cameraRef.current,
			snapshot.boids,
			snapshot.predators,
			worldSize,
			sizeRef.current.width,
			sizeRef.current.height,
			BOID_LENGTH,
		);
		drawScene(
			ctx,
			snapshot.boids,
			snapshot.predators,
			cameraRef.current,
			sizeRef.current.width,
			sizeRef.current.height,
		);
		if (showBoundaryRef.current) {
			drawWorldBoundary(
				ctx,
				cameraRef.current,
				sizeRef.current.width,
				sizeRef.current.height,
				worldSize,
			);
		}
		if (showMinimapRef.current) {
			const minimapCtx = minimapCanvasRef.current?.getContext("2d");
			if (minimapCtx) {
				drawMinimap(
					minimapCtx,
					snapshot.boids,
					snapshot.predators,
					cameraRef.current,
					sizeRef.current.width,
					sizeRef.current.height,
					worldSize,
					MINIMAP_WIDTH,
					MINIMAP_HEIGHT,
				);
			}
		}
	}

	const { status } = api.simulation.watch.useSubscription(
		{ runId },
		{
			onData: ({ data }) => {
				// tRPC subscriptions auto-reconnect — a prior error can clear on
				// its own once new data arrives again. Without this, a stale
				// error message would linger under a canvas that's visibly
				// updating again, misleading the user into thinking the view is
				// still broken.
				setViewError(null);
				lastSnapshotRef.current = data;
				setLiveCounts({
					boids: data.boids.length,
					predators: data.predators.length,
				});
				redraw();
				syncLiveParams(data.liveParams);
				// per-tribe-predator-config Phase 5: `data.tribeConfigs`/
				// `data.predatorTribeConfigs` are optional on this test file's own
				// fixture type (pre-Phase-5 tests push `onData` payloads that never
				// set them) — tolerate `undefined` the same way other post-hoc
				// LiveRunSnapshot fields are tolerated elsewhere in this codebase,
				// rather than requiring every existing call site to be touched.
				if (data.tribeConfigs) {
					setBoidTribeValues((current) =>
						syncTribeArray("boid", data.tribeConfigs, current),
					);
				}
				if (data.predatorTribeConfigs) {
					setPredatorTribeValues((current) =>
						syncTribeArray("predator", data.predatorTribeConfigs, current),
					);
				}
			},
			onError: (error) => {
				setViewError(error.message);
			},
		},
	);

	return (
		<div className="flex w-full max-w-xs flex-col items-center gap-2">
			{/* AGENTS.md disallows arbitrary Tailwind values (e.g. aspect-[3/2]) —
			the 3:2 drawing-buffer ratio is expressed as an inline style instead,
			same posture as simulation-canvas.tsx's equivalent wrapper. */}
			<div
				className="relative w-full"
				style={{ aspectRatio: `${CANVAS_WIDTH} / ${CANVAS_HEIGHT}` }}
			>
				<canvas
					className="h-full w-full rounded-2xl"
					height={CANVAS_HEIGHT}
					ref={canvasRef}
					width={CANVAS_WIDTH}
				/>
				<Button
					className="bg-input text-foreground hover:bg-foreground/35 absolute top-2 right-2 h-auto rounded-full px-4 py-1 text-xs font-semibold"
					onClick={recenter}
					type="button"
				>
					Re-center
				</Button>
				{showMinimap ? (
					<canvas
						className="border-border/40 bg-background/60 absolute bottom-2 left-2 rounded border"
						height={MINIMAP_HEIGHT}
						ref={minimapCanvasRef}
						width={MINIMAP_WIDTH}
					/>
				) : null}
			</div>
			<div className="flex w-full items-center justify-center gap-6">
				<label
					className="flex items-center gap-2 text-sm"
					htmlFor="server-run-minimap-visible"
				>
					Minimap
					<Switch
						checked={showMinimap}
						id="server-run-minimap-visible"
						onCheckedChange={handleToggleMinimap}
					/>
				</label>
				<label
					className="flex items-center gap-2 text-sm"
					htmlFor="server-run-boundary-visible"
				>
					Boundary indicator
					<Switch
						checked={showBoundary}
						id="server-run-boundary-visible"
						onCheckedChange={handleToggleBoundary}
					/>
				</label>
			</div>
			<p className="text-foreground text-sm">
				{status === "pending" || status === "connecting"
					? "Connecting..."
					: null}
			</p>
			{liveValues ? (
				<div className="bg-input/40 flex w-full flex-col gap-2 rounded-2xl p-3">
					<p className="text-foreground text-sm font-semibold">
						Live parameters
					</p>
					<p className="text-foreground text-sm font-semibold">
						Takes effect immediately
					</p>
					<div className="flex flex-col gap-2">
						{IMMEDIATE_FIELDS.map((field) =>
							renderLiveField(field, liveValues),
						)}
						{liveCounts
							? renderPopulationControl(
									"boidCount",
									"Boid count",
									liveCounts.boids,
								)
							: null}
						{liveCounts
							? renderPopulationControl(
									"predatorCount",
									"Predator count",
									liveCounts.predators,
								)
							: null}
					</div>
					<p className="text-foreground text-sm font-semibold">
						Affects future offspring only
					</p>
					<div className="flex flex-col gap-2">
						{FUTURE_OFFSPRING_FIELDS.map((field) =>
							renderLiveField(field, liveValues),
						)}
					</div>
					<Button
						className="bg-input text-foreground hover:bg-foreground/35 h-auto rounded-full px-6 py-2 text-sm font-semibold"
						disabled={applyCooldown || updateRunParamsMutation.isPending}
						onClick={handleApplyLiveParams}
						type="button"
					>
						{applyCooldown ? "Applied" : "Apply"}
					</Button>
					{unmatchedWarnings().map((warning) => (
						<p className="text-destructive text-xs" key={warning}>
							{warning}
						</p>
					))}
				</div>
			) : null}
			{boidTribeValues && boidTribeValues.length > 0 ? (
				<div className="bg-input/40 flex w-full flex-col gap-2 rounded-2xl p-3">
					<p className="text-foreground text-sm font-semibold">
						Boid tribes (live)
					</p>
					{boidTribeValues.map((tribe, index) => (
						<div
							className="bg-input/30 flex flex-col gap-2 rounded-xl p-2"
							// biome-ignore lint/suspicious/noArrayIndexKey: tribe index IS the stable identity here — boidTribeValues is the run's fixed-size flockCount array, indexed by flockId, never reordered/filtered.
							key={index}
						>
							<p className="text-foreground text-xs font-semibold">
								Boid tribe {index + 1}
							</p>
							{boidTribeFieldDefs.map((def) =>
								renderTribeField("boid", index, def, tribe[def.field]),
							)}
							{renderTribeCrossbreedingSwitch(
								"boid",
								index,
								tribe.crossbreedingEnabled,
							)}
						</div>
					))}
					<Button
						className="bg-input text-foreground hover:bg-foreground/35 h-auto rounded-full px-6 py-2 text-sm font-semibold"
						disabled={
							boidTribeApplyCooldown || updateTribeConfigsMutation.isPending
						}
						onClick={handleApplyBoidTribes}
						type="button"
					>
						{boidTribeApplyCooldown ? "Applied" : "Apply boid tribes"}
					</Button>
					{tribeWarnings
						.filter((warning) => !warning.startsWith("predator tribe "))
						.map((warning) => (
							<p className="text-destructive text-xs" key={warning}>
								{warning}
							</p>
						))}
				</div>
			) : null}
			{predatorTribeValues && predatorTribeValues.length > 0 ? (
				<div className="bg-input/40 flex w-full flex-col gap-2 rounded-2xl p-3">
					<p className="text-foreground text-sm font-semibold">
						Predator tribes (live)
					</p>
					{predatorTribeValues.map((tribe, index) => (
						<div
							className="bg-input/30 flex flex-col gap-2 rounded-xl p-2"
							// biome-ignore lint/suspicious/noArrayIndexKey: predator tribe index IS the stable identity here — predatorTribeValues is the run's fixed-size predatorFlockCount array, indexed by predatorFlockId, never reordered/filtered.
							key={index}
						>
							<p className="text-foreground text-xs font-semibold">
								Predator tribe {index + 1}
							</p>
							{predatorTribeFieldDefs.map((def) =>
								renderTribeField("predator", index, def, tribe[def.field]),
							)}
							{renderTribeCrossbreedingSwitch(
								"predator",
								index,
								tribe.crossbreedingEnabled,
							)}
						</div>
					))}
					<Button
						className="bg-input text-foreground hover:bg-foreground/35 h-auto rounded-full px-6 py-2 text-sm font-semibold"
						disabled={
							predatorTribeApplyCooldown ||
							updatePredatorTribeConfigsMutation.isPending
						}
						onClick={handleApplyPredatorTribes}
						type="button"
					>
						{predatorTribeApplyCooldown ? "Applied" : "Apply predator tribes"}
					</Button>
					{tribeWarnings
						.filter((warning) => warning.startsWith("predator tribe "))
						.map((warning) => (
							<p className="text-destructive text-xs" key={warning}>
								{warning}
							</p>
						))}
				</div>
			) : null}
			{viewError ? <p className="text-destructive">{viewError}</p> : null}
			<Button
				className="bg-input text-foreground hover:bg-foreground/35 h-auto rounded-full px-10 py-3 font-semibold"
				onClick={onClose}
				type="button"
			>
				Stop viewing
			</Button>
		</div>
	);
}
