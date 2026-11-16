// S-23 (FR-029): a wrap-aware 3D uniform grid for narrowing bounded-radius
// neighbor queries from O(N) candidates to a handful, without changing any
// exact-distance math a caller applies afterward. Ported from the cell-
// size/bucket-table/candidate-narrow-then-exact-filter technique in this
// project's own prior LÖVE2D/Lua implementation (`getEntitiesInRadius`,
// `/mnt/Kids/boids_final/game/main.lua:154-186`) — but that world is
// bounded, not toroidal, so its cell iteration never wraps. This grid's
// cell iteration does, because every consumer in `boids.ts` wraps positions
// into `[0, worldSize)` and expects a boid near one edge to see neighbors
// "through the seam" on the opposite edge.
//
// Candidates are returned as original-array indices, sorted ascending —
// never as items or in cell-bucket order. That sort is load-bearing for
// `reproducePopulation`'s first-match-by-ascending-index rule (see its own
// comment at the call site); every other consumer here just happens not to
// care about order, so making it a property of the grid itself removes an
// entire class of possible correctness bugs instead of asking each caller
// to remember to sort.
//
// Buckets are a flat array indexed by a bijective (not hashed) encoding of
// each cell's 3D index, not a string- or hash-keyed Map — this function is
// called once per boid per tick (hundreds of thousands of times across a
// single long-running simulation), so avoiding string allocation and map
// hashing overhead in the hot path matters more here than it would in a
// one-off utility.
export type Position3 = { x: number; y: number; z: number };

// A dense cluster (many items sharing one cell neighborhood) can otherwise
// return a candidate list whose size is unbounded by anything but item
// count, turning the per-boid exact-filter pass that follows into O(N) work
// again. Capping bounds that cost uniformly for every caller; the warn-sink
// below lets a caller notice when the cap actually bit for a given query.
export const DENSE_CLUSTER_CANDIDATE_CAP = 64;

export type DenseClusterWarnSink = { triggered: boolean };

export type SpatialGrid = {
	// Candidate indices into the array `buildSpatialGrid` was given, sorted
	// ascending. Still narrows only by cell, not by true distance — callers
	// must exact-filter the result themselves, exactly as they did against
	// the full array before this grid existed. Truncated to
	// DENSE_CLUSTER_CANDIDATE_CAP when the pre-cap result is larger; pass
	// `warnSink` to learn whether a given call truncated.
	queryRadius(
		position: Position3,
		radius: number,
		warnSink?: DenseClusterWarnSink,
	): number[];
};

function axisCellCount(worldSize: number, cellSize: number): number {
	return Math.max(1, Math.ceil(worldSize / cellSize));
}

// Positions in this codebase are always already wrapped into [0, worldSize)
// by `wrap()` before they reach this grid — floor-dividing by cellSize and
// clamping into [0, dim) here is a defensive floor, not a second wrap pass.
function axisCellIndex(pos: number, cellSize: number, dim: number): number {
	const raw = Math.floor(pos / cellSize);
	return ((raw % dim) + dim) % dim;
}

export function buildSpatialGrid<T>(
	items: readonly T[],
	getPosition: (item: T) => Position3,
	cellSize: number,
	worldSize: Position3,
): SpatialGrid {
	const dimX = axisCellCount(worldSize.x, cellSize);
	const dimY = axisCellCount(worldSize.y, cellSize);
	const dimZ = axisCellCount(worldSize.z, cellSize);

	function flatIndex(ix: number, iy: number, iz: number): number {
		return ix + dimX * (iy + dimY * iz);
	}

	const cells: (number[] | undefined)[] = new Array(dimX * dimY * dimZ);
	for (let index = 0; index < items.length; index++) {
		const item = items[index];
		if (!item) continue;
		const pos = getPosition(item);
		const ix = axisCellIndex(pos.x, cellSize, dimX);
		const iy = axisCellIndex(pos.y, cellSize, dimY);
		const iz = axisCellIndex(pos.z, cellSize, dimZ);
		const flat = flatIndex(ix, iy, iz);
		const bucket = cells[flat];
		if (bucket) {
			bucket.push(index);
		} else {
			cells[flat] = [index];
		}
	}

	return {
		queryRadius(
			position: Position3,
			radius: number,
			warnSink?: DenseClusterWarnSink,
		): number[] {
			const centerX = axisCellIndex(position.x, cellSize, dimX);
			const centerY = axisCellIndex(position.y, cellSize, dimY);
			const centerZ = axisCellIndex(position.z, cellSize, dimZ);
			const range = Math.max(1, Math.ceil(radius / cellSize));

			// A wrapped search span wider than the grid itself would visit
			// the same cell twice (e.g. range=2 over a 3-wide axis), which
			// would return the same index twice — only possible when the
			// search radius is large relative to cellSize/worldSize, not for
			// any radius/cellSize pairing this codebase actually uses today,
			// but checked rather than assumed so a future caller with a
			// different radius can't silently get duplicate candidates.
			const needsDedup = 2 * range + 1 > Math.min(dimX, dimY, dimZ);
			const seen = needsDedup ? new Set<number>() : null;
			const result: number[] = [];

			for (let dx = -range; dx <= range; dx++) {
				const ix = (((centerX + dx) % dimX) + dimX) % dimX;
				for (let dy = -range; dy <= range; dy++) {
					const iy = (((centerY + dy) % dimY) + dimY) % dimY;
					for (let dz = -range; dz <= range; dz++) {
						const iz = (((centerZ + dz) % dimZ) + dimZ) % dimZ;
						const bucket = cells[flatIndex(ix, iy, iz)];
						if (!bucket) continue;
						for (const index of bucket) {
							if (seen) {
								if (seen.has(index)) continue;
								seen.add(index);
							}
							result.push(index);
						}
					}
				}
			}

			result.sort((a, b) => a - b);

			if (result.length > DENSE_CLUSTER_CANDIDATE_CAP) {
				if (warnSink) {
					warnSink.triggered = true;
				}
				return result.slice(0, DENSE_CLUSTER_CANDIDATE_CAP);
			}

			return result;
		},
	};
}
