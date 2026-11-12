"use client";

import { useEffect, useRef, useState } from "react";

import { Button } from "~/components/ui/button";
import {
	type BoidState,
	computeCohesion,
	createInitialPopulation,
	createInitialPredators,
	type FlockWeights,
	type PredatorState,
	runTick,
} from "~/server/simulation/boids";
import { createRng } from "~/server/simulation/rng";
import {
	BOID_FILL_COLOR,
	CANVAS_BACKGROUND,
	PREDATOR_FILL_COLOR,
} from "~/styles/theme-colors";
import { api } from "~/trpc/react";

const CANVAS_WIDTH = 600;
const CANVAS_HEIGHT = 400;
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
// Clamp a single frame's dt so a backgrounded/stalled tab can't apply one
// huge physics step when it resumes.
const MAX_DT_SECONDS = 0.1;

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
	onFinished: () => void;
};

type DrawEntity = {
	x: number;
	y: number;
	z: number;
	vx: number;
	vy: number;
	kind: "boid" | "predator";
};

function drawScene(
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
	// Draw farthest-first so nearer entities (drawn later) paint over farther
	// ones at overlapping screen positions instead of the reverse.
	const sorted = entities.sort((a, b) => b.z - a.z);
	for (const entity of sorted) {
		const x = entity.x * RENDER_SCALE + RENDER_OFFSET_X;
		const y = entity.y * RENDER_SCALE + RENDER_OFFSET_Y;
		// Heading from current velocity; zero velocity (e.g. the very first
		// frame) points along +x as a stable default.
		const speed = Math.hypot(entity.vx, entity.vy);
		const heading = speed > 0 ? Math.atan2(entity.vy, entity.vx) : 0;
		// Closer entities (smaller z) render bigger; clamped so the inverse-
		// linear falloff can't blow up as z approaches 0 or vanish at range.
		const scale = Math.min(
			MAX_SCALE,
			Math.max(MIN_SCALE, REFERENCE_DEPTH / (REFERENCE_DEPTH + entity.z)),
		);

		ctx.save();
		ctx.translate(x, y);
		ctx.rotate(heading);
		ctx.beginPath();
		if (entity.kind === "predator") {
			ctx.fillStyle = PREDATOR_FILL_COLOR;
			// Diamond silhouette: nose, both wings, tail — visibly wider than
			// the boid's narrow triangle at the same depth-scale factor.
			ctx.moveTo(PREDATOR_LENGTH * scale, 0);
			ctx.lineTo(0, PREDATOR_WIDTH * scale);
			ctx.lineTo(-PREDATOR_LENGTH * scale, 0);
			ctx.lineTo(0, -PREDATOR_WIDTH * scale);
		} else {
			ctx.fillStyle = BOID_FILL_COLOR;
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
	onFinished,
}: SimulationCanvasProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const boidsRef = useRef<BoidState[]>([]);
	const predatorsRef = useRef<PredatorState[]>([]);
	const foodStockRef = useRef(foodStockInitial);
	const cohesionSamplesRef = useRef<number[]>([]);
	const elapsedSecondsRef = useRef(0);
	const rafIdRef = useRef<number>(0);
	const lastTimestampRef = useRef<number | null>(null);
	const hasStoppedRef = useRef(false);
	const [status, setStatus] = useState<"running" | "stopped">("running");

	const stopRun = api.simulation.stop.useMutation();

	// biome-ignore lint/correctness/useExhaustiveDependencies: intentional run-once-per-run effect — seed/boidCount/weights/maxDurationSeconds/predatorCount/protectionThreshold/foodStockInitial/foodRegenRate/stopRun.mutate are fixed for the lifetime of one run and only runId identifies a new run.
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
		const rng = createRng(seed);
		boidsRef.current = createInitialPopulation(boidCount, rng, maxLifespan);
		predatorsRef.current = createInitialPredators(
			predatorCount,
			rng,
			maxLifespan,
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
			stopRun.mutate({
				runId,
				elapsedTicks: elapsedSecondsRef.current,
				cohesionSamples:
					cohesionSamplesRef.current.length > 0
						? cohesionSamplesRef.current
						: [0],
			});
		}

		function tick(timestamp: number) {
			if (lastTimestampRef.current === null) {
				lastTimestampRef.current = timestamp;
			}
			const dtSeconds = Math.min(
				(timestamp - lastTimestampRef.current) / 1000,
				MAX_DT_SECONDS,
			);
			lastTimestampRef.current = timestamp;

			// Composed pipeline (see boids.ts's runTick doc comment for the
			// fixed order and why it's load-bearing): stepBoids -> stepPredators
			// -> applyHunger -> applyPredation, as one tested entry point so this
			// loop can't drift from the order pipeline.test.ts verifies.
			const {
				boids: nextBoids,
				predators: steeredPredators,
				foodStock: nextFoodStock,
			} = runTick(
				{
					boids: boidsRef.current,
					predators: predatorsRef.current,
					foodStock: foodStockRef.current,
				},
				{ weights, dtSeconds, foodRegenRate, protectionThreshold },
			);

			boidsRef.current = nextBoids;
			predatorsRef.current = steeredPredators;
			foodStockRef.current = nextFoodStock;
			cohesionSamplesRef.current.push(computeCohesion(nextBoids));
			elapsedSecondsRef.current += dtSeconds;

			drawScene(ctx, nextBoids, steeredPredators);

			if (
				elapsedSecondsRef.current >= maxDurationSeconds ||
				nextBoids.length === 0
			) {
				stop();
				return;
			}

			rafIdRef.current = requestAnimationFrame(tick);
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
		stopRun.mutate({
			runId,
			elapsedTicks: elapsedSecondsRef.current,
			cohesionSamples:
				cohesionSamplesRef.current.length > 0
					? cohesionSamplesRef.current
					: [0],
		});
	}

	return (
		<div className="flex flex-col items-center gap-4">
			<canvas
				className="border-border/20 rounded-lg border"
				height={CANVAS_HEIGHT}
				ref={canvasRef}
				width={CANVAS_WIDTH}
			/>
			{status === "running" ? (
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
