"use client";

import { useEffect, useRef, useState } from "react";

import {
	type Camera,
	computeMinimapCamera,
	computeViewportRectOnMinimap,
	resolveCameraForFrame,
	type WorldSize,
	worldToScreenX,
	worldToScreenY,
} from "~/app/simulation/_components/camera";
import { useCamera } from "~/app/simulation/_components/use-camera";
import { Button } from "~/components/ui/button";
import { Switch } from "~/components/ui/switch";
import {
	type BoidGenes,
	type BoidState,
	createInitialPopulation,
	createInitialPredators,
	type FlockWeights,
	type PopulationPhase,
	type PredatorState,
} from "~/server/simulation/boids";
import { createRng } from "~/server/simulation/rng";
import { computeSingleRunTick } from "~/server/simulation/single-run-lifecycle";
import {
	CANVAS_BACKGROUND,
	CANVAS_BORDER_COLOR,
	CANVAS_HIGHLIGHT_COLOR,
} from "~/styles/theme-colors";
import { api } from "~/trpc/react";

// S-24 Phase 2: these are now only the *initial* drawing-buffer size, kept
// around as a sensible default/fallback (and for ServerRunViewer to seed its
// own camera with before its ResizeObserver fires) — the canvas itself
// resizes responsively via useCamera's ResizeObserver, and the old fixed
// RENDER_SCALE/RENDER_OFFSET_X/Y world-to-pixel mapping is gone, replaced by
// the camera transform (camera.ts).
export const CANVAS_WIDTH = 600;
export const CANVAS_HEIGHT = 400;
// S-24 Phase 3: the minimap's own fixed small drawing-buffer size — same
// 3:2 ratio as the main canvas for visual consistency, scaled down to a
// corner-overlay size. Exported so ServerRunViewer sizes its own minimap
// `<canvas>` identically rather than re-deriving the ratio.
export const MINIMAP_WIDTH = 120;
export const MINIMAP_HEIGHT = 80;
// Triangle half-length (nose to tail-center) and half-width (wing to wing),
// drawn pointing along each boid's current heading for a bird/fish-like look.
// Exported so camera.ts's max-zoom ceiling ("a few boid-lengths across") is
// derived from the real rendered boid size, not a second hardcoded number.
export const BOID_LENGTH = 6;
const BOID_WIDTH = 4;
// Predators render as a wider/diamond silhouette (vs. the boid's narrow
// triangle) so they're distinguishable by shape alone, not just color.
const PREDATOR_LENGTH = 7;
const PREDATOR_WIDTH = 7;
// Depth at which a boid renders at its base size (scale 1); centered on
// this project's pre-S-24 default zDepth (200) so the inverse-linear
// falloff below spans the typical z range instead of saturating at one
// end of it. zDepth is now a per-run parameter (S-24), but this constant
// stays a fixed rendering reference point, not re-derived per run.
const REFERENCE_DEPTH = 100;
// Clamp bounds on the depth-derived scale factor — the inverse-linear
// formula grows unbounded as z approaches 0, so this keeps very close boids
// from ballooning and very far ones from shrinking to nothing.
const MIN_SCALE = 0.3;
const MAX_SCALE = 2.0;

type SimulationCanvasProps = {
	runId: number;
	seed: number;
	boidCount: number;
	weights: FlockWeights;
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
	// S-24: the run's configured spatial extent — xyArea covers x and y,
	// zDepth covers z.
	xyArea: number;
	zDepth: number;
	onFinished: () => void;
};

type DrawEntity = {
	x: number;
	y: number;
	z: number;
	vx: number;
	vy: number;
	genes: BoidGenes;
	kind: "boid" | "predator";
};

// Closer entities (smaller z) render bigger; clamped so the inverse-linear
// falloff can't blow up as z approaches 0 or vanish at range. Pure and
// DOM-free so it's directly unit-testable without a canvas context.
export function computeDepthScale(z: number): number {
	return Math.min(
		MAX_SCALE,
		Math.max(MIN_SCALE, REFERENCE_DEPTH / (REFERENCE_DEPTH + z)),
	);
}

// Draw farthest-first so nearer entities (drawn later) paint over farther
// ones at overlapping screen positions instead of the reverse. Pure
// comparator, directly unit-testable without a canvas context.
export function compareByDepth(a: { z: number }, b: { z: number }): number {
	return b.z - a.z;
}

// Converts a gene-carried unit-interval [0,1] RGB color into a CSS
// `rgb(...)` string canvas's ctx.fillStyle accepts. Each channel is clamped
// to [0,1] before scaling to [0,255] and rounded with Math.round — defensive
// against an out-of-range value even though boids.ts's inheritGenes already
// clamps color channels to [0,1] at birth. Pure and DOM-free so it's directly
// unit-testable without a canvas context, same as computeDepthScale/
// compareByDepth above.
export function colorToCss({
	r,
	g,
	b,
}: {
	r: number;
	g: number;
	b: number;
}): string {
	function toChannel(value: number): number {
		return Math.round(Math.min(1, Math.max(0, value)) * 255);
	}
	return `rgb(${toChannel(r)}, ${toChannel(g)}, ${toChannel(b)})`;
}

// Exported for ServerRunViewer (S-07) to reuse unchanged — already pure
// given a canvas context + boids/predators arrays. S-24 Phase 2: the fixed
// world-to-pixel mapping is gone, replaced by the shared camera transform —
// `camera`/`canvasWidth`/`canvasHeight` are explicit parameters (not read
// from `ctx.canvas`) so this stays testable against a fake context that
// implements only the drawing methods below. Entity x/y/z, boid-length, and
// depth-cue constants/`computeDepthScale` below are unchanged.
export function drawScene(
	ctx: CanvasRenderingContext2D,
	boids: BoidState[],
	predators: PredatorState[],
	camera: Camera,
	canvasWidth: number,
	canvasHeight: number,
) {
	ctx.clearRect(0, 0, canvasWidth, canvasHeight);
	ctx.fillStyle = CANVAS_BACKGROUND;
	ctx.fillRect(0, 0, canvasWidth, canvasHeight);

	const entities: DrawEntity[] = [
		...boids.map((boid): DrawEntity => ({ ...boid, kind: "boid" })),
		...predators.map(
			(predator): DrawEntity => ({
				...predator,
				kind: "predator",
			}),
		),
	];
	const sorted = entities.sort(compareByDepth);
	for (const entity of sorted) {
		const x = worldToScreenX(entity.x, camera, canvasWidth);
		const y = worldToScreenY(entity.y, camera, canvasHeight);
		// Heading from current velocity; zero velocity (e.g. the very first
		// frame) points along +x as a stable default.
		const speed = Math.hypot(entity.vx, entity.vy);
		const heading = speed > 0 ? Math.atan2(entity.vy, entity.vx) : 0;
		const scale = computeDepthScale(entity.z);

		ctx.save();
		ctx.translate(x, y);
		ctx.rotate(heading);
		ctx.beginPath();
		ctx.fillStyle = colorToCss(entity.genes.color);
		if (entity.kind === "predator") {
			// Diamond silhouette: nose, both wings, tail — visibly wider than
			// the boid's narrow triangle at the same depth-scale factor.
			ctx.moveTo(PREDATOR_LENGTH * scale, 0);
			ctx.lineTo(0, PREDATOR_WIDTH * scale);
			ctx.lineTo(-PREDATOR_LENGTH * scale, 0);
			ctx.lineTo(0, -PREDATOR_WIDTH * scale);
		} else {
			ctx.moveTo(BOID_LENGTH * scale, 0);
			ctx.lineTo(-BOID_LENGTH * scale, BOID_WIDTH * scale);
			ctx.lineTo(-BOID_LENGTH * scale, -BOID_WIDTH * scale);
		}
		ctx.closePath();
		ctx.fill();
		ctx.restore();
	}
}

// S-24 Phase 3: draws the toroidal world's four edges — the rectangle
// [0, worldSize.x] x [0, worldSize.y] in world space — using the exact same
// worldToScreenX/Y transform the entities above use, so the boundary stays
// correctly positioned through pan/zoom instead of being a fixed-position
// decoration. Exported for ServerRunViewer (S-07) to reuse unchanged.
export function drawWorldBoundary(
	ctx: CanvasRenderingContext2D,
	camera: Camera,
	canvasWidth: number,
	canvasHeight: number,
	worldSize: WorldSize,
) {
	const left = worldToScreenX(0, camera, canvasWidth);
	const top = worldToScreenY(0, camera, canvasHeight);
	const right = worldToScreenX(worldSize.x, camera, canvasWidth);
	const bottom = worldToScreenY(worldSize.y, camera, canvasHeight);

	ctx.save();
	ctx.strokeStyle = CANVAS_BORDER_COLOR;
	ctx.lineWidth = 1;
	ctx.strokeRect(left, top, right - left, bottom - top);
	ctx.restore();
}

// S-24 Phase 3: a small overlay showing the FULL configured world (not the
// main camera's zoomed view) at a fixed small scale, plus a rectangle
// marking where the main camera's current viewport sits within it. Reuses
// `drawScene` itself for the entity-drawing pass (same shapes/colors/depth
// logic, zero divergence) by targeting a separate small canvas with its own
// fixed, whole-world-fitting camera (`computeMinimapCamera`) — not a
// second, divergent rendering implementation. Exported for ServerRunViewer
// (S-07) to reuse unchanged.
export function drawMinimap(
	minimapCtx: CanvasRenderingContext2D,
	boids: BoidState[],
	predators: PredatorState[],
	mainCamera: Camera,
	mainCanvasWidth: number,
	mainCanvasHeight: number,
	worldSize: WorldSize,
	minimapWidth: number,
	minimapHeight: number,
) {
	const minimapCamera = computeMinimapCamera(
		worldSize,
		minimapWidth,
		minimapHeight,
	);
	drawScene(
		minimapCtx,
		boids,
		predators,
		minimapCamera,
		minimapWidth,
		minimapHeight,
	);

	const rect = computeViewportRectOnMinimap(
		mainCamera,
		mainCanvasWidth,
		mainCanvasHeight,
		minimapCamera,
		minimapWidth,
		minimapHeight,
	);
	minimapCtx.save();
	minimapCtx.strokeStyle = CANVAS_HIGHLIGHT_COLOR;
	minimapCtx.lineWidth = 1;
	minimapCtx.strokeRect(rect.x, rect.y, rect.width, rect.height);
	minimapCtx.restore();

	minimapCtx.save();
	minimapCtx.strokeStyle = CANVAS_BORDER_COLOR;
	minimapCtx.lineWidth = 1;
	minimapCtx.strokeRect(0, 0, minimapWidth, minimapHeight);
	minimapCtx.restore();
}

export function SimulationCanvas({
	runId,
	seed,
	boidCount,
	weights,
	maxDurationSeconds,
	predatorCount,
	protectionThreshold,
	foodStockInitial,
	foodRegenRate,
	flockCount,
	crossbreedingEnabled,
	energyThreshold,
	mutationChance,
	mutationMagnitude,
	xyArea,
	zDepth,
	onFinished,
}: SimulationCanvasProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	// Fixed for this component instance's lifetime — props are fixed for the
	// lifetime of a run (the page remounts this component with a new `key`
	// per runId), same as the mount effect below already assumes.
	const worldSize = { x: xyArea, y: xyArea, z: zDepth };
	// Created once per run (inside the run-once effect below) and reused for
	// every tick's createInitial*/computeSingleRunTick call, never recreated —
	// a fresh rng per tick would make reproduction's mutation/gender rolls
	// non-deterministic across ticks.
	const rngRef = useRef<() => number>(() => Math.random());
	const boidsRef = useRef<BoidState[]>([]);
	const predatorsRef = useRef<PredatorState[]>([]);
	const foodStockRef = useRef(foodStockInitial);
	const cohesionSamplesRef = useRef<number[]>([]);
	// S-04 (FR-010 full, FR-019): threaded through the same shared tick core
	// server-run-registry.ts uses — see single-run-lifecycle.ts.
	const foodRatioSamplesRef = useRef<number[]>([]);
	const populationCountSamplesRef = useRef<number[]>([]);
	// S-25 (FR-010 full, FR-035): raw per-tick density samples feeding the
	// 5th scoring factor — threaded through the same shared tick core as
	// the other sample arrays.
	const populationDensitySamplesRef = useRef<number[]>([]);
	const phaseHistoryRef = useRef<PopulationPhase[]>([]);
	const elapsedSecondsRef = useRef(0);
	const rafIdRef = useRef<number>(0);
	const lastTimestampRef = useRef<number | null>(null);
	const hasStoppedRef = useRef(false);
	const [status, setStatus] = useState<"running" | "stopped">("running");
	const [tickError, setTickError] = useState<string | null>(null);
	const [populationCapped, setPopulationCapped] = useState(false);

	// S-24 Phase 2: camera state/input/resize for this canvas instance —
	// per-component, not shared/persisted (see use-camera.ts).
	const { cameraRef, sizeRef, recenter } = useCamera({
		boidLength: BOID_LENGTH,
		canvasRef,
		defaultSize: { width: CANVAS_WIDTH, height: CANVAS_HEIGHT },
		onChange: () => redraw(),
		worldSize,
	});

	// S-24 Phase 3: minimap/boundary toggles. Mirrored into both a ref (the
	// source of truth `redraw()` reads — see the comment below on why a ref,
	// not state, is what redraw must read) and a `useState` purely so the
	// `Switch` controls below can render their current `checked` value.
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

	// Resolves the camera for the current boids/predators snapshot and
	// redraws. Called both from the tick loop below (new data) and from
	// useCamera's onChange (pan/zoom/resize input between ticks). This
	// function itself is captured once by the mount effect below and by
	// useCamera's own effect (both have narrow dependency arrays, by
	// design — see their own biome-ignore comments), so it must read
	// per-toggle visibility from refs (showMinimapRef/showBoundaryRef), not
	// from `showMinimap`/`showBoundary` state directly — a state read here
	// would close over whichever value was current when the effect first
	// ran and never see a later toggle.
	function redraw() {
		const ctx = canvasRef.current?.getContext("2d");
		if (!ctx) {
			return;
		}
		resolveCameraForFrame(
			cameraRef.current,
			boidsRef.current,
			predatorsRef.current,
			worldSize,
			sizeRef.current.width,
			sizeRef.current.height,
			BOID_LENGTH,
		);
		drawScene(
			ctx,
			boidsRef.current,
			predatorsRef.current,
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
					boidsRef.current,
					predatorsRef.current,
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

	const stopRun = api.simulation.stop.useMutation({
		onError: (error, variables) => {
			console.error(
				`simulation.stop failed for run ${variables.runId}: ${error.message}`,
				error,
			);
		},
	});

	// S-04 (FR-010 full, FR-019): the signals `stop`'s mutation input needs
	// so the server can compute the real 4-factor score. Sends raw signals
	// (same trust posture `cohesionSamples` already established — client
	// reports, server computes), not pre-computed factor numbers.
	// `survivingBoidGenes` carries only the gene fields
	// `computeGeneticDiversity` reads, not full per-boid position/velocity/
	// age/energy state it doesn't need. Defined at component scope (not
	// inside the effect below) so both the effect's `stop()` and
	// `handleManualStop()` below can call it.
	function buildStopInput() {
		return {
			runId,
			elapsedTicks: elapsedSecondsRef.current,
			cohesionSamples:
				cohesionSamplesRef.current.length > 0
					? cohesionSamplesRef.current
					: [0],
			foodRatioSamples:
				foodRatioSamplesRef.current.length > 0
					? foodRatioSamplesRef.current
					: [0],
			phaseHistory:
				phaseHistoryRef.current.length > 0
					? phaseHistoryRef.current
					: (["establishment"] satisfies PopulationPhase[]),
			survivingBoidGenes: boidsRef.current.map((boid) => boid.genes),
			// plan-review F1 (run-analysis-view): was tracked but never sent —
			// same fallback pattern as the other sample arrays above.
			populationCountSamples:
				populationCountSamplesRef.current.length > 0
					? populationCountSamplesRef.current
					: [0],
			populationDensitySamples:
				populationDensitySamplesRef.current.length > 0
					? populationDensitySamplesRef.current
					: [0],
		};
	}

	// biome-ignore lint/correctness/useExhaustiveDependencies: intentional run-once-per-run effect — seed/boidCount/weights/maxDurationSeconds/predatorCount/protectionThreshold/foodStockInitial/foodRegenRate/flockCount/crossbreedingEnabled/energyThreshold/mutationChance/mutationMagnitude/xyArea/zDepth/worldSize/redraw/stopRun.mutate are fixed for the lifetime of one run and only runId identifies a new run.
	useEffect(() => {
		const canvas = canvasRef.current;
		const maybeCtx = canvas?.getContext("2d");
		if (!canvas || !maybeCtx) {
			return;
		}

		// Generous relative to maxDurationSeconds so natural lifespan decay
		// doesn't cut the run shorter than the duration the member chose.
		const maxLifespan = Math.max(60, maxDurationSeconds);
		rngRef.current = createRng(seed);
		// Per the plan's "Important design decision": all flocks in a run
		// start from the SAME FlockWeights values — N copies of this one
		// weights prop, not per-flock weight variance. Divergence comes from
		// createInitialPopulation's per-flock seed colors and from mutation
		// during reproduction, not from different starting weights.
		const flockWeights = Array.from({ length: flockCount }, () => weights);
		boidsRef.current = createInitialPopulation(
			boidCount,
			rngRef.current,
			maxLifespan,
			flockCount,
			flockWeights,
			worldSize,
		);
		predatorsRef.current = createInitialPredators(
			predatorCount,
			rngRef.current,
			maxLifespan,
			flockCount,
			flockWeights,
			worldSize,
		);
		foodStockRef.current = foodStockInitial;
		redraw();

		function stop() {
			if (hasStoppedRef.current) {
				return;
			}
			hasStoppedRef.current = true;
			cancelAnimationFrame(rafIdRef.current);
			setStatus("stopped");
			stopRun.mutate(buildStopInput());
		}

		function tick(timestamp: number) {
			try {
				// Decision core (dt computation, composed runTick call, next-state
				// derivation, stop-condition check) lives in computeSingleRunTick so
				// it's directly unit-testable without the canvas/RAF/tRPC shell here.
				const result = computeSingleRunTick(
					{
						boids: boidsRef.current,
						predators: predatorsRef.current,
						foodStock: foodStockRef.current,
						cohesionSamples: cohesionSamplesRef.current,
						foodRatioSamples: foodRatioSamplesRef.current,
						populationCountSamples: populationCountSamplesRef.current,
						populationDensitySamples: populationDensitySamplesRef.current,
						phaseHistory: phaseHistoryRef.current,
						elapsedSeconds: elapsedSecondsRef.current,
						lastTimestamp: lastTimestampRef.current,
					},
					timestamp,
					{
						foodRegenRate,
						protectionThreshold,
						maxDurationSeconds,
						foodStockInitial,
						rng: rngRef.current,
						crossbreedingEnabled,
						energyThreshold,
						mutationChance,
						mutationMagnitude,
						worldSize,
					},
				);

				boidsRef.current = result.boids;
				predatorsRef.current = result.predators;
				foodStockRef.current = result.foodStock;
				cohesionSamplesRef.current = result.cohesionSamples;
				foodRatioSamplesRef.current = result.foodRatioSamples;
				populationCountSamplesRef.current = result.populationCountSamples;
				populationDensitySamplesRef.current = result.populationDensitySamples;
				phaseHistoryRef.current = result.phaseHistory;
				elapsedSecondsRef.current = result.elapsedSeconds;
				lastTimestampRef.current = result.lastTimestamp;
				setPopulationCapped(result.populationCapped);

				redraw();

				if (result.shouldStop) {
					stop();
					return;
				}

				rafIdRef.current = requestAnimationFrame(tick);
			} catch (error) {
				// The tick's own state may be unreliable at this point — stop the
				// loop and tell the user, but don't attempt to score a broken run
				// via stop(). Logged too — the on-screen message alone leaves no
				// trace if the tab closes before anyone reads it.
				cancelAnimationFrame(rafIdRef.current);
				console.error("simulation tick failed:", error);
				setTickError(error instanceof Error ? error.message : String(error));
			}
		}

		rafIdRef.current = requestAnimationFrame(tick);

		return () => {
			cancelAnimationFrame(rafIdRef.current);
		};
		// Props are fixed for the lifetime of a run (the page remounts this
		// component with a new `key` per runId), so this effect runs once.
	}, [runId]);

	function handleManualStop() {
		if (hasStoppedRef.current) {
			return;
		}
		hasStoppedRef.current = true;
		cancelAnimationFrame(rafIdRef.current);
		setStatus("stopped");
		stopRun.mutate(buildStopInput());
	}

	return (
		<div className="flex flex-col items-center gap-4">
			{/* AGENTS.md disallows arbitrary Tailwind values (e.g. aspect-[3/2]) —
			the 3:2 drawing-buffer ratio is expressed as an inline style instead,
			same posture as any other non-token, non-color numeric layout value. */}
			<div
				className="relative w-full max-w-2xl"
				style={{ aspectRatio: `${CANVAS_WIDTH} / ${CANVAS_HEIGHT}` }}
			>
				<canvas
					className="border-border/20 h-full w-full rounded-lg border"
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
			<div className="flex w-full max-w-2xl items-center justify-center gap-6">
				<label
					className="flex items-center gap-2 text-sm"
					htmlFor="minimap-visible"
				>
					Minimap
					<Switch
						checked={showMinimap}
						id="minimap-visible"
						onCheckedChange={handleToggleMinimap}
					/>
				</label>
				<label
					className="flex items-center gap-2 text-sm"
					htmlFor="boundary-visible"
				>
					Boundary indicator
					<Switch
						checked={showBoundary}
						id="boundary-visible"
						onCheckedChange={handleToggleBoundary}
					/>
				</label>
			</div>
			{populationCapped ? (
				<p className="text-muted-foreground text-sm">
					Population capped — at the object limit
				</p>
			) : null}
			{tickError ? (
				<div className="flex flex-col items-center gap-2">
					<p className="text-destructive">Simulation error: {tickError}</p>
					<Button
						className="bg-input text-foreground hover:bg-foreground/35 h-auto rounded-full px-10 py-3 font-semibold"
						onClick={onFinished}
						type="button"
					>
						Start New Run
					</Button>
				</div>
			) : status === "running" ? (
				<Button
					className="bg-input text-foreground hover:bg-foreground/35 h-auto rounded-full px-10 py-3 font-semibold"
					onClick={handleManualStop}
					type="button"
				>
					Stop
				</Button>
			) : (
				<div className="flex flex-col items-center gap-2">
					<p className="text-lg">
						{stopRun.isPending
							? "Scoring run..."
							: stopRun.data
								? `Score: ${stopRun.data.score.toFixed(2)}`
								: stopRun.error
									? `Failed to score run: ${stopRun.error.message}`
									: null}
					</p>
					<Button
						className="bg-input text-foreground hover:bg-foreground/35 h-auto rounded-full px-10 py-3 font-semibold"
						onClick={onFinished}
						type="button"
					>
						Start New Run
					</Button>
				</div>
			)}
		</div>
	);
}
