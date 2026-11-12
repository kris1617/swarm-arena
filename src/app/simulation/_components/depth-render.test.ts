import { describe, expect, it } from "vitest";
import { compareByDepth, computeDepthScale } from "./simulation-canvas";

// Oracle for these tests is the documented contract (near = bigger, far =
// smaller, clamped to a fixed range; farthest-first draw order) — never a
// value computed the same way the implementation computes it.

describe("computeDepthScale", () => {
	it("returns exactly 1 at the reference depth (z = 0), the formula's own defined base point", () => {
		// REFERENCE_DEPTH / (REFERENCE_DEPTH + 0) === 1 for any REFERENCE_DEPTH,
		// so z = 0 is the contract's fixed scale-1 point regardless of the
		// constant's current value.
		expect(computeDepthScale(0)).toBe(1);
	});

	it("renders a nearer entity (smaller z) strictly larger than a farther one (larger z)", () => {
		const near = computeDepthScale(20);
		const far = computeDepthScale(180);
		expect(near).toBeGreaterThan(far);
	});

	it("clamps the scale to the documented upper bound (2.0) even where the unclamped formula would exceed it", () => {
		// Unclamped, z approaching -REFERENCE_DEPTH drives the formula toward
		// +Infinity; the contract's clamp must cap it at 2.0 regardless.
		expect(computeDepthScale(-99)).toBe(2.0);
	});

	it("clamps the scale to the documented lower bound (0.3) even where the unclamped formula would fall below it", () => {
		// Unclamped, large z drives the formula toward 0; the contract's
		// clamp must floor it at 0.3, so two sufficiently large z values
		// produce the identical floored scale rather than two distinct,
		// ever-shrinking ones.
		expect(computeDepthScale(10_000)).toBe(0.3);
		expect(computeDepthScale(100_000)).toBe(0.3);
	});
});

describe("compareByDepth", () => {
	it("orders entities farthest-first (descending z)", () => {
		const entities = [{ z: 50 }, { z: 150 }, { z: 10 }];
		const sorted = [...entities].sort(compareByDepth);
		expect(sorted.map((e) => e.z)).toEqual([150, 50, 10]);
	});

	it("is a valid comparator: swapping the comparand order flips the sign", () => {
		const a = { z: 30 };
		const b = { z: 90 };
		expect(Math.sign(compareByDepth(a, b))).toBe(
			-Math.sign(compareByDepth(b, a)),
		);
	});
});
