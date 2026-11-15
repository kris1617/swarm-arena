// S-24 Phase 2: the camera transform shared by both rendering paths
// (simulation-canvas.tsx's staging canvas and server-run-viewer.tsx's live
// viewer). Pure, DOM-free logic lives here so it's directly unit-testable
// without a canvas context — same posture as simulation-canvas.tsx's
// computeDepthScale/compareByDepth/colorToCss.
import { circularMean } from "~/server/simulation/boids";

export type CameraMode = "auto" | "manual";

export type Camera = {
	centerX: number;
	centerY: number;
	zoom: number;
	mode: CameraMode;
};

export type WorldSize = { x: number; y: number; z: number };

// "A few boid-lengths across" (plan Phase 2, Contract #1): the max-zoom
// ceiling is expressed as a multiple of the boid's own length rather than a
// fixed world-unit number, so it stays meaningful regardless of the run's
// configured world size or the canvas's current pixel size.
const MAX_ZOOM_BOID_LENGTHS = 8;

// Centered in the world by default — the very first frame (before any
// auto-follow update has run, e.g. an empty population) shows the world's
// middle rather than an arbitrary (0,0) corner.
export function createDefaultCamera(worldSize: WorldSize): Camera {
	return {
		centerX: worldSize.x / 2,
		centerY: worldSize.y / 2,
		zoom: 1,
		mode: "auto",
	};
}

// The zoom level that keeps the full configured world visible in the
// canvas — the lower bound (most zoomed-out) a camera should ever reach,
// since zooming out further would just show empty space beyond the
// toroidal world. Derived from the run's real worldSize/canvas size, never
// a hardcoded 200.
export function computeMinZoom(
	worldSize: WorldSize,
	canvasWidth: number,
	canvasHeight: number,
): number {
	if (worldSize.x <= 0 || worldSize.y <= 0) {
		return 1;
	}
	return Math.min(canvasWidth / worldSize.x, canvasHeight / worldSize.y);
}

// The fixed sensible zoom ceiling: a few boid-lengths span the canvas's
// width. Derived from the canvas's current size and the boid's real
// rendered length, not a hardcoded number.
export function computeMaxZoom(
	canvasWidth: number,
	boidLength: number,
): number {
	if (boidLength <= 0) {
		return Number.POSITIVE_INFINITY;
	}
	return canvasWidth / (MAX_ZOOM_BOID_LENGTHS * boidLength);
}

export function clampZoom(
	zoom: number,
	minZoom: number,
	maxZoom: number,
): number {
	// Defensive ordering: a pathological combination of a tiny canvas and a
	// huge configured world can push the "keep whole world visible" bound
	// above the "few boid-lengths" ceiling. Clamping against whichever is
	// actually smaller/larger, rather than assuming minZoom <= maxZoom,
	// keeps this from ever producing an inverted (empty) range.
	const lo = Math.min(minZoom, maxZoom);
	const hi = Math.max(minZoom, maxZoom);
	return Math.min(hi, Math.max(lo, zoom));
}

export function worldToScreenX(
	worldX: number,
	camera: Camera,
	canvasWidth: number,
): number {
	return (worldX - camera.centerX) * camera.zoom + canvasWidth / 2;
}

export function worldToScreenY(
	worldY: number,
	camera: Camera,
	canvasHeight: number,
): number {
	return (worldY - camera.centerY) * camera.zoom + canvasHeight / 2;
}

// Mutates `camera` in place (only when in "auto" mode) to track the live
// population's centroid, using the same circular-mean approach boids.ts's
// own centroid math uses for wrapped coordinates — a population straddling
// the wrap seam needs circular-mean centering, not a plain arithmetic
// average. A momentarily-empty population leaves the camera at its last
// center rather than snapping to NaN/0.
export function updateAutoFollowCenter(
	camera: Camera,
	boids: ReadonlyArray<{ x: number; y: number }>,
	predators: ReadonlyArray<{ x: number; y: number }>,
	worldSize: WorldSize,
): void {
	if (camera.mode !== "auto") {
		return;
	}
	const xs: number[] = [];
	const ys: number[] = [];
	for (const entity of boids) {
		xs.push(entity.x);
		ys.push(entity.y);
	}
	for (const entity of predators) {
		xs.push(entity.x);
		ys.push(entity.y);
	}
	if (xs.length === 0) {
		return;
	}
	camera.centerX = circularMean(xs, worldSize.x);
	camera.centerY = circularMean(ys, worldSize.y);
}

// S-24 Phase 3: a fixed camera for the minimap pass — always centered on and
// fitted to the FULL configured world (never the live population's
// centroid, and never "manual"), at whatever zoom keeps the whole world
// visible within the minimap's own small drawing surface. Reuses
// computeMinZoom (the same "keep the whole world visible" math the main
// camera's own lower zoom bound already uses) rather than a second formula.
export function computeMinimapCamera(
	worldSize: WorldSize,
	minimapWidth: number,
	minimapHeight: number,
): Camera {
	return {
		centerX: worldSize.x / 2,
		centerY: worldSize.y / 2,
		zoom: computeMinZoom(worldSize, minimapWidth, minimapHeight),
		mode: "auto",
	};
}

// The main camera's current viewport, expressed as a rectangle in the
// minimap's own small pixel space. Derived from the main camera's
// centerX/centerY/zoom and the main canvas's width/height (the inverse of
// worldToScreenX/Y: screen center -> world-space half-extents), then mapped
// into minimap pixels through worldToScreenX/Y using the minimap's own
// fixed camera — the exact same transform an entity position goes through,
// just against a different camera. Does not account for the viewport
// wrapping around a toroidal edge (e.g. a camera centered near x=0 whose
// left edge wraps to worldSize.x) — the rectangle can extend slightly
// outside the minimap's own world bounds in that case, which is an accepted
// visual simplification for this overlay, not a correctness bug in the
// main view's own wrap behavior.
export function computeViewportRectOnMinimap(
	mainCamera: Camera,
	mainCanvasWidth: number,
	mainCanvasHeight: number,
	minimapCamera: Camera,
	minimapWidth: number,
	minimapHeight: number,
): { x: number; y: number; width: number; height: number } {
	const halfWorldWidth = mainCanvasWidth / 2 / mainCamera.zoom;
	const halfWorldHeight = mainCanvasHeight / 2 / mainCamera.zoom;
	const left = mainCamera.centerX - halfWorldWidth;
	const top = mainCamera.centerY - halfWorldHeight;
	const right = mainCamera.centerX + halfWorldWidth;
	const bottom = mainCamera.centerY + halfWorldHeight;

	const screenLeft = worldToScreenX(left, minimapCamera, minimapWidth);
	const screenTop = worldToScreenY(top, minimapCamera, minimapHeight);
	const screenRight = worldToScreenX(right, minimapCamera, minimapWidth);
	const screenBottom = worldToScreenY(bottom, minimapCamera, minimapHeight);

	return {
		x: screenLeft,
		y: screenTop,
		width: screenRight - screenLeft,
		height: screenBottom - screenTop,
	};
}

// Resolves a camera's state for the frame about to be drawn: in "auto" mode,
// re-centers on the live population and re-fits zoom to the current
// canvas/world size (so resizing the window never leaves auto-follow
// showing a stale zoom level); in "manual" mode, only re-clamps the user's
// chosen zoom against the current bounds (which can themselves change if
// the canvas resizes). Mutates `camera` in place.
export function resolveCameraForFrame(
	camera: Camera,
	boids: ReadonlyArray<{ x: number; y: number }>,
	predators: ReadonlyArray<{ x: number; y: number }>,
	worldSize: WorldSize,
	canvasWidth: number,
	canvasHeight: number,
	boidLength: number,
): void {
	const minZoom = computeMinZoom(worldSize, canvasWidth, canvasHeight);
	const maxZoom = computeMaxZoom(canvasWidth, boidLength);
	if (camera.mode === "auto") {
		updateAutoFollowCenter(camera, boids, predators, worldSize);
		camera.zoom = clampZoom(minZoom, minZoom, maxZoom);
	} else {
		camera.zoom = clampZoom(camera.zoom, minZoom, maxZoom);
	}
}
