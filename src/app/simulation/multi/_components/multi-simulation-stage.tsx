"use client";

import { useEffect, useRef, useState } from "react";

import { Button } from "~/components/ui/button";
import {
	type BoidState,
	computeCohesion,
	createInitialPopulation,
	stepBoids,
} from "~/server/simulation/boids";
import { createRng } from "~/server/simulation/rng";
import type { RunSlot } from "~/server/simulation/run-slots";
import { BOID_FILL_COLOR, CANVAS_BACKGROUND } from "~/styles/theme-colors";
import { api } from "~/trpc/react";

// S-05 (parallel-sim-switching): one shared requestAnimationFrame loop steps
// every "running" slot's boid state each frame (so background runs never
// stall while unviewed), but draws only the currently active slot — the
// architecture that satisfies the PRD's "switching doesn't slow the others"
// guardrail. Deliberately duplicated from (not imported from)
// simulation-canvas.tsx's constants/draw routine — see plan.md "What We're
// NOT Doing": that file is concurrently owned by S-02's plan.

const CANVAS_WIDTH = 600;
const CANVAS_HEIGHT = 400;
const RENDER_SCALE = 2;
const RENDER_OFFSET_X = (CANVAS_WIDTH - 200 * RENDER_SCALE) / 2;
const RENDER_OFFSET_Y = (CANVAS_HEIGHT - 200 * RENDER_SCALE) / 2;
const BOID_LENGTH = 6;
const BOID_WIDTH = 4;
const REFERENCE_DEPTH = 100;
const MIN_SCALE = 0.3;
const MAX_SCALE = 2.0;
// Clamp a single frame's dt so a backgrounded/stalled tab can't apply one
// huge physics step when it resumes.
const MAX_DT_SECONDS = 0.1;

type RunState = {
	boids: BoidState[];
	cohesionSamples: number[];
	elapsedSeconds: number;
};

export type MultiSimulationStageProps = {
	slots: RunSlot[];
	activeRunId: number | null;
	onFinished: (runId: number, score: number) => void;
};

function drawBoids(ctx: CanvasRenderingContext2D, boids: BoidState[]) {
	ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
	ctx.fillStyle = CANVAS_BACKGROUND;
	ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
	ctx.fillStyle = BOID_FILL_COLOR;
	// Draw farthest-first so nearer boids (drawn later) paint over farther
	// ones at overlapping screen positions instead of the reverse.
	const sortedBoids = [...boids].sort((a, b) => b.z - a.z);
	for (const boid of sortedBoids) {
		const x = boid.x * RENDER_SCALE + RENDER_OFFSET_X;
		const y = boid.y * RENDER_SCALE + RENDER_OFFSET_Y;
		const speed = Math.hypot(boid.vx, boid.vy);
		const heading = speed > 0 ? Math.atan2(boid.vy, boid.vx) : 0;
		const scale = Math.min(
			MAX_SCALE,
			Math.max(MIN_SCALE, REFERENCE_DEPTH / (REFERENCE_DEPTH + boid.z)),
		);

		ctx.save();
		ctx.translate(x, y);
		ctx.rotate(heading);
		ctx.beginPath();
		ctx.moveTo(BOID_LENGTH * scale, 0);
		ctx.lineTo(-BOID_LENGTH * scale, BOID_WIDTH * scale);
		ctx.lineTo(-BOID_LENGTH * scale, -BOID_WIDTH * scale);
		ctx.closePath();
		ctx.fill();
		ctx.restore();
	}
}

export function MultiSimulationStage({
	slots,
	activeRunId,
	onFinished,
}: MultiSimulationStageProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const runStatesRef = useRef<Map<number, RunState>>(new Map());
	const rafIdRef = useRef<number>(0);
	const lastTimestampRef = useRef<number | null>(null);
	const slotsRef = useRef<RunSlot[]>(slots);
	const activeRunIdRef = useRef<number | null>(activeRunId);
	const finishedRunIdsRef = useRef<Set<number>>(new Set());
	const onFinishedRef = useRef(onFinished);
	// Set by the manual "Stop" button below; checked once per tick so a
	// manual stop on the active slot ends it immediately instead of waiting
	// for the next automatic stop condition (duration elapsed / wiped out).
	const manualStopRequestRef = useRef<number | null>(null);
	const [manualStopPendingRunId, setManualStopPendingRunId] = useState<
		number | null
	>(null);

	slotsRef.current = slots;
	activeRunIdRef.current = activeRunId;
	onFinishedRef.current = onFinished;

	const stopRun = api.simulation.stop.useMutation();

	// biome-ignore lint/correctness/useExhaustiveDependencies: deliberately run-once effect — the loop reads slots/activeRunId/onFinished/stopRun.mutate via refs (kept current above) so it never needs to restart and re-seed state for a slot that's already running when some other prop changes.
	useEffect(() => {
		const canvas = canvasRef.current;
		const maybeCtx = canvas?.getContext("2d");
		if (!canvas || !maybeCtx) {
			return;
		}
		const ctx: CanvasRenderingContext2D = maybeCtx;
		const runStates = runStatesRef.current;

		function stopSlot(slot: RunSlot, runState: RunState) {
			if (finishedRunIdsRef.current.has(slot.runId)) {
				return;
			}
			finishedRunIdsRef.current.add(slot.runId);
			const cohesionSamples =
				runState.cohesionSamples.length > 0 ? runState.cohesionSamples : [0];
			stopRun.mutate(
				{
					runId: slot.runId,
					elapsedTicks: runState.elapsedSeconds,
					cohesionSamples,
				},
				{
					onSuccess: (data) => {
						setManualStopPendingRunId((current) =>
							current === slot.runId ? null : current,
						);
						onFinishedRef.current(slot.runId, data.score);
					},
				},
			);
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

			const currentSlots = slotsRef.current;
			const liveRunIds = new Set(currentSlots.map((slot) => slot.runId));
			// Drop entries for slots removed from `slots` (dismissed) so the
			// map doesn't grow unboundedly across a long session.
			for (const runId of runStates.keys()) {
				if (!liveRunIds.has(runId)) {
					runStates.delete(runId);
				}
			}

			for (const slot of currentSlots) {
				if (slot.status !== "running") {
					continue;
				}

				let runState = runStates.get(slot.runId);
				if (!runState) {
					// Generous relative to maxDurationSeconds so natural
					// lifespan decay doesn't cut the run shorter than the
					// duration the member chose.
					const maxLifespan = Math.max(60, slot.maxDurationSeconds);
					runState = {
						boids: createInitialPopulation(
							slot.boidCount,
							createRng(slot.seed),
							maxLifespan,
						),
						cohesionSamples: [],
						elapsedSeconds: 0,
					};
					runStates.set(slot.runId, runState);
				}

				const nextBoids = stepBoids(runState.boids, slot.weights, dtSeconds);
				runState.boids = nextBoids;
				runState.cohesionSamples.push(computeCohesion(nextBoids));
				runState.elapsedSeconds += dtSeconds;

				if (
					runState.elapsedSeconds >= slot.maxDurationSeconds ||
					nextBoids.length === 0 ||
					manualStopRequestRef.current === slot.runId
				) {
					manualStopRequestRef.current = null;
					stopSlot(slot, runState);
				}
			}

			const activeSlot = currentSlots.find(
				(slot) => slot.runId === activeRunIdRef.current,
			);
			const activeRunState = activeSlot
				? runStates.get(activeSlot.runId)
				: undefined;
			if (activeRunState) {
				drawBoids(ctx, activeRunState.boids);
			} else {
				ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
				ctx.fillStyle = CANVAS_BACKGROUND;
				ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
			}

			rafIdRef.current = requestAnimationFrame(tick);
		}

		rafIdRef.current = requestAnimationFrame(tick);

		return () => {
			cancelAnimationFrame(rafIdRef.current);
		};
	}, []);

	const activeSlot = slots.find((slot) => slot.runId === activeRunId);
	const canStopActiveSlot =
		activeSlot?.status === "running" &&
		manualStopPendingRunId !== activeSlot.runId;

	function handleManualStop() {
		if (!activeSlot || !canStopActiveSlot) {
			return;
		}
		manualStopRequestRef.current = activeSlot.runId;
		setManualStopPendingRunId(activeSlot.runId);
	}

	return (
		<div className="flex flex-col items-center gap-4">
			<canvas
				className="border-border/20 rounded-lg border"
				height={CANVAS_HEIGHT}
				ref={canvasRef}
				width={CANVAS_WIDTH}
			/>
			{activeSlot?.status === "running" ? (
				<Button
					className="bg-input text-foreground hover:bg-foreground/35 h-auto rounded-full px-10 py-3 font-semibold"
					disabled={!canStopActiveSlot}
					onClick={handleManualStop}
					type="button"
				>
					{manualStopPendingRunId === activeSlot.runId ? "Stopping..." : "Stop"}
				</Button>
			) : null}
		</div>
	);
}
