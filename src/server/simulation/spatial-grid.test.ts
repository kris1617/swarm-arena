import { describe, expect, it } from "vitest";

import {
	buildSpatialGrid,
	DENSE_CLUSTER_CANDIDATE_CAP,
	type DenseClusterWarnSink,
} from "~/server/simulation/spatial-grid";

type Point = { x: number; y: number; z: number };

function point(x: number, y: number, z = 5): Point {
	return { x, y, z };
}

describe("buildSpatialGrid", () => {
	it("finds an item in the same cell", () => {
		const items = [point(1, 1), point(2, 2), point(50, 50)];
		const grid = buildSpatialGrid(items, (p) => p, 10, {
			x: 100,
			y: 100,
			z: 100,
		});

		const candidates = grid.queryRadius(point(0, 0), 5);

		expect(candidates).toContain(0);
		expect(candidates).toContain(1);
		expect(candidates).not.toContain(2);
	});

	it(
		"finds a neighbor across the wrap seam — the one behavior the Lua " +
			"reference's own grid never needed (its world is bounded, not " +
			"toroidal), and the main new-code risk this port introduces",
		() => {
			// World width 100, cell size 10 (dim 10). An item at x=99 and a
			// query at x=1 are 98 raw units apart (not found by a non-wrapping
			// grid), but only 2 units apart through the seam.
			const items = [point(99, 50), point(50, 50)];
			const grid = buildSpatialGrid(items, (p) => p, 10, {
				x: 100,
				y: 100,
				z: 100,
			});

			const candidates = grid.queryRadius(point(1, 50), 5);

			expect(candidates).toContain(0);
			expect(candidates).not.toContain(1);
		},
	);

	it("wraps correctly on all three axes simultaneously, not just one", () => {
		const items = [point(99, 99, 99)];
		const grid = buildSpatialGrid(items, (p) => p, 10, {
			x: 100,
			y: 100,
			z: 100,
		});

		expect(grid.queryRadius(point(1, 1, 1), 5)).toContain(0);
	});

	it("returns candidate indices sorted ascending, not bucket order", () => {
		// Insert in an order that would surface bucket order if the grid
		// didn't sort: index 2 lands in the query's own cell, indices 0/1
		// land in cells visited later by the nested dx/dy/dz loop.
		const items = [point(80, 80), point(81, 81), point(1, 1)];
		const grid = buildSpatialGrid(items, (p) => p, 10, {
			x: 100,
			y: 100,
			z: 100,
		});

		const candidates = grid.queryRadius(point(0, 0), 50);

		expect(candidates).toEqual([...candidates].sort((a, b) => a - b));
	});

	it("deduplicates a candidate found via more than one wrapped cell offset", () => {
		// A tiny world (one cell per axis) forces every offset in the query's
		// search range to wrap back onto the same single cell — without
		// dedup, the same item would be returned once per offset.
		const items = [point(5, 5)];
		const grid = buildSpatialGrid(items, (p) => p, 100, {
			x: 100,
			y: 100,
			z: 100,
		});

		const candidates = grid.queryRadius(point(5, 5), 200);

		expect(candidates).toEqual([0]);
	});

	it("never returns an item genuinely outside the search radius' cell neighborhood", () => {
		const items = [point(0, 0), point(50, 50)];
		const grid = buildSpatialGrid(items, (p) => p, 10, {
			x: 100,
			y: 100,
			z: 100,
		});

		// Item 1 sits in cell 5; a radius-5 query from cell 0 only reaches
		// the adjacent cell ring (range = ceil(5/10) = 1, offsets -1/0/1),
		// nowhere near cell 5 on either wrap direction.
		expect(grid.queryRadius(point(0, 0), 5)).not.toContain(1);
	});

	it("caps a dense cluster's candidates at DENSE_CLUSTER_CANDIDATE_CAP and stays fast", () => {
		const items = Array.from({ length: 10_000 }, () => point(5, 5));
		const grid = buildSpatialGrid(items, (p) => p, 10, {
			x: 100,
			y: 100,
			z: 100,
		});
		const warnSink: DenseClusterWarnSink = { triggered: false };

		const start = performance.now();
		const candidates = grid.queryRadius(point(5, 5), 5, warnSink);
		const durationMs = performance.now() - start;

		expect(candidates.length).toBe(DENSE_CLUSTER_CANDIDATE_CAP);
		// Generous budget — under full-suite parallel CPU contention a tight
		// (e.g. 5ms) budget flakes even though the cap logic itself is correct;
		// 100ms is still orders of magnitude faster than an uncapped scan over
		// this many candidates would need once downstream callers (mate-scan,
		// force computation) process them, while the length assertion above
		// is the real, non-timing-dependent proof the cap works.
		expect(durationMs).toBeLessThan(100);
		expect(warnSink.triggered).toBe(true);
	});

	it("leaves a normal-density query's candidates and warn-sink untouched", () => {
		const items = [point(1, 1), point(2, 2), point(50, 50)];
		const grid = buildSpatialGrid(items, (p) => p, 10, {
			x: 100,
			y: 100,
			z: 100,
		});
		const warnSink: DenseClusterWarnSink = { triggered: false };

		const candidates = grid.queryRadius(point(0, 0), 5, warnSink);

		expect(candidates).toEqual([0, 1]);
		expect(warnSink.triggered).toBe(false);
	});
});
