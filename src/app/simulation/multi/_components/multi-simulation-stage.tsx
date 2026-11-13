"use client";

import { useEffect, useRef, useState } from "react";

import { colorToCss } from "~/app/simulation/_components/simulation-canvas";
import { Button } from "~/components/ui/button";
import type { BoidState, PredatorState } from "~/server/simulation/boids";
import {
	computeMultiRunTick,
	type RunState,
} from "~/server/simulation/multi-run-lifecycle";
import type { RunSlot } from "~/server/simulation/run-slots";
import { CANVAS_BACKGROUND } from "~/styles/theme-colors";
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
// Predators render as a wider/diamond silhouette (vs. the boid's narrow
// triangle) — same visual treatment as simulation-canvas.tsx's drawScene.
const PREDATOR_LENGTH = 7;
const PREDATOR_WIDTH = 7;
const REFERENCE_DEPTH = 100;
const MIN_SCALE = 0.3;
const MAX_SCALE = 2.0;

export type MultiSimulationStageProps = {
	slots: RunSlot[];
	activeRunId: number | null;
	// `score` is `undefined` when the slot was force-finished after its stop
	// mutation errored — see `stopSlot`'s `onError` below.
	onFinished: (runId: number, score?: number) => void;
	// Called only when a running slot's populationCapped flag changes value
	// (not every tick) — the shared RAF loop below already avoids per-tick
	// setState for things it draws directly (activeDrawBoids); mirroring
	// that here keeps a capped/uncapped slot from re-rendering the parent
	// page every frame while it stays capped.
	onPopulationCapped?: (runId: number, capped: boolean) => void;
};

type DrawEntity = {
	x: number;
	y: number;
	z: number;
	vx: number;
	vy: number;
	genes: BoidState["genes"];
	kind: "boid" | "predator";
};

// Draws both species for the active slot — same visual treatment as
// simulation-canvas.tsx's drawScene (boid = narrow triangle, predator =
// wider diamond silhouette, depth-sorted by z, each colored via its own
// genes.color), reusing colorToCss from that file since that's this file's
// natural dependency direction (the reverse would be circular).
function drawBoids(
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
			(predator): DrawEntity => ({ ...predator, kind: "predator" }),
		),
	];
	// Draw farthest-first so nearer entities (drawn later) paint over farther
	// ones at overlapping screen positions instead of the reverse.
	const sorted = entities.sort((a, b) => b.z - a.z);
	for (const entity of sorted) {
		const x = entity.x * RENDER_SCALE + RENDER_OFFSET_X;
		const y = entity.y * RENDER_SCALE + RENDER_OFFSET_Y;
		const speed = Math.hypot(entity.vx, entity.vy);
		const heading = speed > 0 ? Math.atan2(entity.vy, entity.vx) : 0;
		const scale = Math.min(
			MAX_SCALE,
			Math.max(MIN_SCALE, REFERENCE_DEPTH / (REFERENCE_DEPTH + entity.z)),
		);

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

export function MultiSimulationStage({
	slots,
	activeRunId,
	onFinished,
	onPopulationCapped,
}: MultiSimulationStageProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const runStatesRef = useRef<Record<number, RunState>>({});
	const rafIdRef = useRef<number>(0);
	const lastTimestampRef = useRef<number | null>(null);
	const slotsRef = useRef<RunSlot[]>(slots);
	const activeRunIdRef = useRef<number | null>(activeRunId);
	const finishedRunIdsRef = useRef<Set<number>>(new Set());
	const onFinishedRef = useRef(onFinished);
	const onPopulationCappedRef = useRef(onPopulationCapped);
	// Last-known-per-slot value, used only to detect a change worth
	// forwarding via onPopulationCappedRef — never read back into the tick
	// loop's own decisions.
	const lastPopulationCappedRef = useRef<Record<number, boolean>>({});
	// Set by the manual "Stop" button below; checked once per tick so a
	// manual stop on the active slot ends it immediately instead of waiting
	// for the next automatic stop condition (duration elapsed / wiped out).
	const manualStopRequestRef = useRef<number | null>(null);
	const [manualStopPendingRunId, setManualStopPendingRunId] = useState<
		number | null
	>(null);
	const [tickError, setTickError] = useState<string | null>(null);

	useEffect(() => {
		slotsRef.current = slots;
		activeRunIdRef.current = activeRunId;
		onFinishedRef.current = onFinished;
		onPopulationCappedRef.current = onPopulationCapped;
	}, [slots, activeRunId, onFinished, onPopulationCapped]);

	const stopRun = api.simulation.stop.useMutation();

	// biome-ignore lint/correctness/useExhaustiveDependencies: deliberately run-once effect — the loop reads slots/activeRunId/onFinished/stopRun.mutate via refs (kept current above) so it never needs to restart and re-seed state for a slot that's already running when some other prop changes.
	useEffect(() => {
		const canvas = canvasRef.current;
		const maybeCtx = canvas?.getContext("2d");
		if (!canvas || !maybeCtx) {
			return;
		}
		const ctx: CanvasRenderingContext2D = maybeCtx;

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
					// Without this, a network/server error leaves the slot
					// permanently "running" (stepping already stopped via
					// finishedRunIdsRef above, but status/UI never reflects
					// it) — undismissable and stuck on "Stopping..." forever.
					// Force-finish with no score instead, matching the
					// single-run page's unconditional terminal-state guarantee.
					onError: (error) => {
						console.error(
							`simulation.stop failed for run ${slot.runId}: ${error.message}`,
							error,
						);
						setManualStopPendingRunId((current) =>
							current === slot.runId ? null : current,
						);
						onFinishedRef.current(slot.runId, undefined);
					},
				},
			);
		}

		function tick(timestamp: number) {
			try {
				const result = computeMultiRunTick(
					{
						runStates: runStatesRef.current,
						lastTimestamp: lastTimestampRef.current,
					},
					timestamp,
					slotsRef.current,
					activeRunIdRef.current,
					manualStopRequestRef.current,
				);

				runStatesRef.current = result.runStates;
				lastTimestampRef.current = result.lastTimestamp;
				manualStopRequestRef.current = result.nextManualStopRequestId;

				const liveRunIds = new Set(slotsRef.current.map((slot) => slot.runId));
				for (const runId of Object.keys(lastPopulationCappedRef.current)) {
					if (!liveRunIds.has(Number(runId))) {
						delete lastPopulationCappedRef.current[Number(runId)];
					}
				}
				for (const [runIdKey, capped] of Object.entries(
					result.populationCappedBySlot ?? {},
				)) {
					const runId = Number(runIdKey);
					if (lastPopulationCappedRef.current[runId] !== capped) {
						lastPopulationCappedRef.current[runId] = capped;
						onPopulationCappedRef.current?.(runId, capped);
					}
				}

				for (const slot of result.slotsToStop) {
					const runState = result.runStates[slot.runId];
					if (runState) {
						stopSlot(slot, runState);
					}
				}

				if (result.activeDrawBoids) {
					drawBoids(
						ctx,
						result.activeDrawBoids,
						result.activeDrawPredators ?? [],
					);
				} else {
					ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
					ctx.fillStyle = CANVAS_BACKGROUND;
					ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
				}

				rafIdRef.current = requestAnimationFrame(tick);
			} catch (error) {
				// A throw here spans every slot (one shared tick call), not just
				// one — there is no finer-grained isolation without a larger
				// architectural change. Stop the loop and tell the user. Logged
				// too — the on-screen message alone leaves no trace if the tab
				// closes before anyone reads it.
				cancelAnimationFrame(rafIdRef.current);
				console.error("simulation tick failed:", error);
				setTickError(error instanceof Error ? error.message : String(error));
				// Force-finish every still-"running" slot (same no-score path as
				// a failed stop mutation) — without this, the dead loop never
				// transitions any slot to "stopped", so the page's "Dismiss"
				// button never appears and the parallel-run cap never clears,
				// leaving no way back except a full page reload.
				for (const slot of slotsRef.current) {
					if (slot.status === "running") {
						onFinishedRef.current(slot.runId, undefined);
					}
				}
			}
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
			{tickError ? (
				<p className="text-destructive">Simulation error: {tickError}</p>
			) : activeSlot?.status === "running" ? (
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
