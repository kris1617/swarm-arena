"use client";

import { useEffect, useRef, useState } from "react";

import { Button } from "~/components/ui/button";
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
import { CANVAS_BACKGROUND } from "~/styles/theme-colors";
import { api } from "~/trpc/react";

// Exported for ServerRunViewer (S-07) to match the staging canvas's exact
// dimensions rather than duplicating the numbers.
export const CANVAS_WIDTH = 600;
export const CANVAS_HEIGHT = 400;
// createInitialPopulation spreads boids over a 0-200 square; scale that up
// and center it so the initial frame isn't tiny in a 600x400 canvas. Boids
// stay within that range indefinitely — stepBoids wraps x/y/z toroidally,
// so they re-enter from the opposite edge instead of drifting off-canvas.
const RENDER_SCALE = 2;
const RENDER_OFFSET_X = (CANVAS_WIDTH - 200 * RENDER_SCALE) / 2;
const RENDER_OFFSET_Y = (CANVAS_HEIGHT - 200 * RENDER_SCALE) / 2;
// Triangle half-length (nose to tail-center) and half-width (wing to wing),
// drawn pointing along each boid's current heading for a bird/fish-like look.
const BOID_LENGTH = 6;
const BOID_WIDTH = 4;
// Predators render as a wider/diamond silhouette (vs. the boid's narrow
// triangle) so they're distinguishable by shape alone, not just color.
const PREDATOR_LENGTH = 7;
const PREDATOR_WIDTH = 7;
// Depth at which a boid renders at its base size (scale 1); centered on
// boids.ts's Z_DEPTH_RANGE (200) so the inverse-linear falloff below spans
// the typical z range instead of saturating at one end of it.
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
// given a canvas context + boids/predators arrays.
export function drawScene(
	ctx: CanvasRenderingContext2D,
	boids: BoidState[],
	predators: PredatorState[],
) {
	ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
	ctx.fillStyle = CANVAS_BACKGROUND;
	ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

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
		const x = entity.x * RENDER_SCALE + RENDER_OFFSET_X;
		const y = entity.y * RENDER_SCALE + RENDER_OFFSET_Y;
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
	const phaseHistoryRef = useRef<PopulationPhase[]>([]);
	const elapsedSecondsRef = useRef(0);
	const rafIdRef = useRef<number>(0);
	const lastTimestampRef = useRef<number | null>(null);
	const hasStoppedRef = useRef(false);
	const [status, setStatus] = useState<"running" | "stopped">("running");
	const [tickError, setTickError] = useState<string | null>(null);
	const [populationCapped, setPopulationCapped] = useState(false);

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
		};
	}

	// biome-ignore lint/correctness/useExhaustiveDependencies: intentional run-once-per-run effect — seed/boidCount/weights/maxDurationSeconds/predatorCount/protectionThreshold/foodStockInitial/foodRegenRate/flockCount/crossbreedingEnabled/energyThreshold/mutationChance/mutationMagnitude/xyArea/zDepth/stopRun.mutate are fixed for the lifetime of one run and only runId identifies a new run.
	useEffect(() => {
		const canvas = canvasRef.current;
		const maybeCtx = canvas?.getContext("2d");
		if (!canvas || !maybeCtx) {
			return;
		}
		const ctx: CanvasRenderingContext2D = maybeCtx;

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
		const worldSize = { x: xyArea, y: xyArea, z: zDepth };
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
		drawScene(ctx, boidsRef.current, predatorsRef.current);

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
				phaseHistoryRef.current = result.phaseHistory;
				elapsedSecondsRef.current = result.elapsedSeconds;
				lastTimestampRef.current = result.lastTimestamp;
				setPopulationCapped(result.populationCapped);

				drawScene(ctx, result.boids, result.predators);

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
			<canvas
				className="border-border/20 rounded-lg border"
				height={CANVAS_HEIGHT}
				ref={canvasRef}
				width={CANVAS_WIDTH}
			/>
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
