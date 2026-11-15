"use client";

import { cn } from "cn";
import { useRef, useState } from "react";

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
import type { BoidState, PredatorState } from "~/server/simulation/boids";
import { DEFAULT_PARAMETER_RANGES } from "~/server/simulation/parameter-ranges";
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
	"crossbreedingEnabled",
] as const satisfies readonly (keyof LiveAdjustableParams)[];

type LiveField = (typeof LIVE_FIELDS)[number];

type LiveFormValues = Record<LiveField, number>;

const LIVE_FIELD_LABELS: Record<LiveField, string> = {
	foodRegenRate: "Food regen rate",
	protectionThreshold: "Protection threshold",
	energyThreshold: "Energy threshold",
	mutationChance: "Mutation chance",
	mutationMagnitude: "Mutation magnitude",
	crossbreedingEnabled: "Crossbreeding enabled",
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
	"crossbreedingEnabled",
] as const satisfies readonly LiveField[];

// How long the Apply button stays disabled after a successful apply
// (decision 6 in plan.md's Overview — client-side only, no server throttle).
const APPLY_COOLDOWN_MS = 500;

// How long a successfully-applied field keeps its success-flash styling.
const FLASH_DURATION_MS = 1000;

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

	// `LiveFormValues` stores every field as a number (so the Switch's
	// `checked` can be derived via `Boolean(...)`), but the subscription's
	// `liveParams` carries `crossbreedingEnabled` as a genuine boolean —
	// coerce it to 0/1 at the one point it enters form state.
	function toFormFieldValue(value: LiveAdjustableParams[LiveField]): number {
		return typeof value === "boolean" ? Number(value) : value;
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
		// The outgoing mutation payload needs `crossbreedingEnabled` as a real
		// boolean (the server's zod schema expects `z.boolean()`), while
		// `LiveFormValues` itself stays all-number so the rest of this
		// component's diffing/dirty-tracking logic doesn't need a special
		// case. Widen only the outgoing payload's type for this one key.
		const outgoingPatch: Partial<
			Omit<LiveFormValues, "crossbreedingEnabled">
		> & {
			crossbreedingEnabled?: boolean;
		} = {};
		for (const field of LIVE_FIELDS) {
			if (liveValues[field] !== applied[field]) {
				patch[field] = liveValues[field];
				if (field === "crossbreedingEnabled") {
					outgoingPatch.crossbreedingEnabled = Boolean(liveValues[field]);
				} else {
					outgoingPatch[field] = liveValues[field];
				}
			}
		}
		if (Object.keys(patch).length === 0) {
			return;
		}
		pendingPatchRef.current = patch;
		updateRunParamsMutation.mutate({ runId, ...outgoingPatch });
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
				{field === "crossbreedingEnabled" ? (
					<label
						className="flex items-center gap-2 text-sm"
						htmlFor={`live-param-${field}`}
					>
						{LIVE_FIELD_LABELS[field]}
						<Switch
							checked={Boolean(values[field])}
							id={`live-param-${field}`}
							onCheckedChange={(checked) =>
								handleLiveFieldChange(field, checked ? 1 : 0)
							}
						/>
					</label>
				) : (
					<NumberField
						id={`live-param-${field}`}
						label={LIVE_FIELD_LABELS[field]}
						max={fieldRange.max}
						min={fieldRange.min}
						onChange={(value) => handleLiveFieldChange(field, value)}
						step={step}
						value={values[field]}
					/>
				)}
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
	// Apply flow), but shared between the boid and predator rows themselves —
	// a population click is rare enough that a single shared cooldown is a
	// reasonable simplification over per-kind state.
	const [populationCooldown, setPopulationCooldown] = useState(false);
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
				setPopulationCooldown(true);
				setTimeout(() => {
					setPopulationCooldown(false);
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
						disabled={adjustPopulationMutation.isPending || populationCooldown}
						onClick={() => handleAdjustPopulation(field, -10)}
						type="button"
					>
						-10
					</Button>
					<Button
						className="bg-input text-foreground hover:bg-foreground/35 h-auto rounded-full px-3 py-1 text-xs font-semibold"
						disabled={adjustPopulationMutation.isPending || populationCooldown}
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
