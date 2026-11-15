"use client";

import { useRef, useState } from "react";

import {
	resolveCameraForFrame,
	type WorldSize,
} from "~/app/simulation/_components/camera";
import {
	BOID_LENGTH,
	CANVAS_HEIGHT,
	CANVAS_WIDTH,
	drawScene,
} from "~/app/simulation/_components/simulation-canvas";
import { useCamera } from "~/app/simulation/_components/use-camera";
import { Button } from "~/components/ui/button";
import type { BoidState, PredatorState } from "~/server/simulation/boids";
import { api } from "~/trpc/react";

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

	const { cameraRef, sizeRef, recenter } = useCamera({
		boidLength: BOID_LENGTH,
		canvasRef,
		defaultSize: { width: CANVAS_WIDTH, height: CANVAS_HEIGHT },
		onChange: () => redraw(),
		worldSize,
	});

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
				redraw();
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
			</div>
			<p className="text-foreground text-sm">
				{status === "pending" || status === "connecting"
					? "Connecting..."
					: null}
			</p>
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
