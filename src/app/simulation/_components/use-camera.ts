"use client";

import { type RefObject, useEffect, useRef } from "react";

import {
	type Camera,
	clampZoom,
	computeMaxZoom,
	computeMinZoom,
	createDefaultCamera,
	type WorldSize,
} from "~/app/simulation/_components/camera";

// How much one "notch" of scroll (deltaY) changes zoom, as a fraction —
// e.g. 0.001 means a 100-unit scroll roughly doubles/halves zoom. Picked for
// a smooth, controllable feel rather than derived from any requirement.
const ZOOM_SENSITIVITY = 0.001;

export type CanvasSize = { width: number; height: number };

// Pan/zoom input + resizable canvas, shared by both consumers of `drawScene`
// (simulation-canvas.tsx, server-run-viewer.tsx) per plan Phase 2 §2/§3 —
// camera state is per-component (this hook's own refs), never a module-level
// singleton, so a later phase can reset it on run-switch/resume just by
// remounting the component (already true today: both consumers key the
// canvas-owning component by runId).
export function useCamera({
	canvasRef,
	worldSize,
	boidLength,
	defaultSize,
	onChange,
}: {
	canvasRef: RefObject<HTMLCanvasElement | null>;
	worldSize: WorldSize;
	boidLength: number;
	defaultSize: CanvasSize;
	// Called after any input-driven or resize-driven change, so the caller
	// can redraw immediately rather than waiting for its own next data push
	// or animation frame (relevant for server-run-viewer.tsx, which only
	// redraws on each ~150ms SSE push otherwise).
	onChange: () => void;
}) {
	const cameraRef = useRef<Camera>(createDefaultCamera(worldSize));
	const sizeRef = useRef<CanvasSize>(defaultSize);

	function recenter() {
		cameraRef.current.mode = "auto";
		onChange();
	}

	// biome-ignore lint/correctness/useExhaustiveDependencies: worldSize/boidLength/defaultSize are fixed for the lifetime of the component instance this hook is called from (both consumers key that component by runId); onChange is stable enough in practice and re-subscribing on every render would churn the listeners for no benefit.
	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) {
			return;
		}

		let isPanning = false;
		let lastClientX = 0;
		let lastClientY = 0;

		function handlePointerDown(event: PointerEvent) {
			isPanning = true;
			lastClientX = event.clientX;
			lastClientY = event.clientY;
			canvas?.setPointerCapture(event.pointerId);
		}

		function handlePointerMove(event: PointerEvent) {
			if (!isPanning) {
				return;
			}
			const dx = event.clientX - lastClientX;
			const dy = event.clientY - lastClientY;
			lastClientX = event.clientX;
			lastClientY = event.clientY;
			const camera = cameraRef.current;
			camera.mode = "manual";
			// Dragging the mouse by (dx, dy) screen pixels should carry the
			// content under the cursor along with it, which means moving the
			// camera's world-space center the opposite way, scaled down by
			// the current zoom (screen px -> world units).
			camera.centerX -= dx / camera.zoom;
			camera.centerY -= dy / camera.zoom;
			onChange();
		}

		function handlePointerUp(event: PointerEvent) {
			isPanning = false;
			canvas?.releasePointerCapture(event.pointerId);
		}

		function handleWheel(event: WheelEvent) {
			event.preventDefault();
			const camera = cameraRef.current;
			camera.mode = "manual";
			const { width, height } = sizeRef.current;
			const minZoom = computeMinZoom(worldSize, width, height);
			const maxZoom = computeMaxZoom(width, boidLength);
			const factor = Math.exp(-event.deltaY * ZOOM_SENSITIVITY);
			camera.zoom = clampZoom(camera.zoom * factor, minZoom, maxZoom);
			onChange();
		}

		canvas.addEventListener("pointerdown", handlePointerDown);
		canvas.addEventListener("pointermove", handlePointerMove);
		canvas.addEventListener("pointerup", handlePointerUp);
		canvas.addEventListener("pointercancel", handlePointerUp);
		canvas.addEventListener("wheel", handleWheel, { passive: false });

		// Keeps the canvas's drawing-buffer width/height (not just its CSS
		// display size) in sync with its actual rendered size, so the scene
		// isn't stretched/squashed when the container resizes — there's no
		// existing ResizeObserver usage elsewhere in this codebase to follow,
		// so this establishes a minimal one scoped to just this element.
		let resizeObserver: ResizeObserver | undefined;
		if (typeof ResizeObserver !== "undefined") {
			resizeObserver = new ResizeObserver((entries) => {
				const entry = entries[0];
				if (!entry) {
					return;
				}
				const width = Math.max(1, Math.round(entry.contentRect.width));
				const height = Math.max(1, Math.round(entry.contentRect.height));
				if (
					width === sizeRef.current.width &&
					height === sizeRef.current.height
				) {
					return;
				}
				sizeRef.current = { width, height };
				canvas.width = width;
				canvas.height = height;
				onChange();
			});
			resizeObserver.observe(canvas);
		}

		return () => {
			canvas.removeEventListener("pointerdown", handlePointerDown);
			canvas.removeEventListener("pointermove", handlePointerMove);
			canvas.removeEventListener("pointerup", handlePointerUp);
			canvas.removeEventListener("pointercancel", handlePointerUp);
			canvas.removeEventListener("wheel", handleWheel);
			resizeObserver?.disconnect();
		};
	}, []);

	return { cameraRef, sizeRef, recenter };
}
