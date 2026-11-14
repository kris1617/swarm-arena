"use client";

import { useRef, useState } from "react";

import {
	CANVAS_HEIGHT,
	CANVAS_WIDTH,
	drawScene,
} from "~/app/simulation/_components/simulation-canvas";
import { Button } from "~/components/ui/button";
import { api } from "~/trpc/react";

type ServerRunViewerProps = {
	runId: number;
	onClose: () => void;
};

// Renders a server-run simulation's live tick state from F-04's SSE
// subscription alone — no local tick loop, no ownership of execution.
// Closing this component only unsubscribes; it never affects the
// underlying run.
export function ServerRunViewer({ runId, onClose }: ServerRunViewerProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const [viewError, setViewError] = useState<string | null>(null);

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
				const ctx = canvasRef.current?.getContext("2d");
				if (ctx) {
					drawScene(ctx, data.boids, data.predators);
				}
			},
			onError: (error) => {
				setViewError(error.message);
			},
		},
	);

	return (
		<div className="flex w-full max-w-xs flex-col items-center gap-2">
			<canvas
				className="rounded-2xl"
				height={CANVAS_HEIGHT}
				ref={canvasRef}
				width={CANVAS_WIDTH}
			/>
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
