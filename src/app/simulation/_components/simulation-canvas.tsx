"use client";

import { useEffect, useRef, useState } from "react";

import {
	type BoidState,
	computeCohesion,
	createInitialPopulation,
	type FlockWeights,
	stepBoids,
} from "~/server/simulation/boids";
import { createRng } from "~/server/simulation/rng";
import { api } from "~/trpc/react";

const CANVAS_WIDTH = 600;
const CANVAS_HEIGHT = 400;
// createInitialPopulation spreads boids over a 0-200 square; scale that up
// and center it so the initial frame isn't tiny in a 600x400 canvas. Boids
// drift outside this range over time since Phase 1's math has no
// wraparound — expected, not something this phase fixes.
const RENDER_SCALE = 2;
const RENDER_OFFSET_X = (CANVAS_WIDTH - 200 * RENDER_SCALE) / 2;
const RENDER_OFFSET_Y = (CANVAS_HEIGHT - 200 * RENDER_SCALE) / 2;
// Triangle half-length (nose to tail-center) and half-width (wing to wing),
// drawn pointing along each boid's current heading for a bird/fish-like look.
const BOID_LENGTH = 6;
const BOID_WIDTH = 4;
// Clamp a single frame's dt so a backgrounded/stalled tab can't apply one
// huge physics step when it resumes.
const MAX_DT_SECONDS = 0.1;

type SimulationCanvasProps = {
	runId: number;
	seed: number;
	boidCount: number;
	weights: FlockWeights;
	maxDurationSeconds: number;
	onFinished: () => void;
};

function drawBoids(ctx: CanvasRenderingContext2D, boids: BoidState[]) {
	ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
	ctx.fillStyle = "#1e293b";
	ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
	ctx.fillStyle = "#38bdf8";
	for (const boid of boids) {
		const x = boid.x * RENDER_SCALE + RENDER_OFFSET_X;
		const y = boid.y * RENDER_SCALE + RENDER_OFFSET_Y;
		// Heading from current velocity; a boid with zero velocity (e.g. the
		// very first frame) points along +x as a stable default.
		const speed = Math.hypot(boid.vx, boid.vy);
		const heading = speed > 0 ? Math.atan2(boid.vy, boid.vx) : 0;

		ctx.save();
		ctx.translate(x, y);
		ctx.rotate(heading);
		ctx.beginPath();
		ctx.moveTo(BOID_LENGTH, 0);
		ctx.lineTo(-BOID_LENGTH, BOID_WIDTH);
		ctx.lineTo(-BOID_LENGTH, -BOID_WIDTH);
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
	onFinished,
}: SimulationCanvasProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const boidsRef = useRef<BoidState[]>([]);
	const cohesionSamplesRef = useRef<number[]>([]);
	const elapsedSecondsRef = useRef(0);
	const rafIdRef = useRef<number>(0);
	const lastTimestampRef = useRef<number | null>(null);
	const hasStoppedRef = useRef(false);
	const [status, setStatus] = useState<"running" | "stopped">("running");

	const stopRun = api.simulation.stop.useMutation();

	// biome-ignore lint/correctness/useExhaustiveDependencies: intentional run-once-per-run effect — seed/boidCount/weights/maxDurationSeconds/stopRun.mutate are fixed for the lifetime of one run and only runId identifies a new run.
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
		boidsRef.current = createInitialPopulation(
			boidCount,
			createRng(seed),
			maxLifespan,
		);
		drawBoids(ctx, boidsRef.current);

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

			const nextBoids = stepBoids(boidsRef.current, weights, dtSeconds);
			boidsRef.current = nextBoids;
			cohesionSamplesRef.current.push(computeCohesion(nextBoids));
			elapsedSecondsRef.current += dtSeconds;

			drawBoids(ctx, nextBoids);

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
		// eslint-disable-next-line react-hooks/exhaustive-deps
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
				className="rounded-lg border border-white/20"
				height={CANVAS_HEIGHT}
				ref={canvasRef}
				width={CANVAS_WIDTH}
			/>
			{status === "running" ? (
				<button
					className="rounded-full bg-white/10 px-10 py-3 font-semibold transition hover:bg-white/20"
					onClick={handleManualStop}
					type="button"
				>
					Stop
				</button>
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
					<button
						className="rounded-full bg-white/10 px-10 py-3 font-semibold transition hover:bg-white/20"
						onClick={onFinished}
						type="button"
					>
						Start New Run
					</button>
				</div>
			)}
		</div>
	);
}
