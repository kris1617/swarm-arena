import { describe, expect, it } from "vitest";
import { Color } from "~/server/simulation/color";

describe("Color.fromHex", () => {
	it("parses a hex string into unit-interval [0,1] RGB", () => {
		const color = Color.fromHex("#ff8000");
		expect(color.r).toBeCloseTo(255 / 255);
		expect(color.g).toBeCloseTo(128 / 255);
		expect(color.b).toBeCloseTo(0 / 255);
	});
});

describe("Color.fromHsl", () => {
	it("matches the pre-refactor hslToUnitColor fixed-point outputs", () => {
		// Characterization fixtures: same formula as the original
		// boids.ts hslToUnitColor, evaluated independently here to pin
		// behavior before boids.ts delegates to this class.
		const color = Color.fromHsl(0, 0.7, 0.55);
		expect(color.r).toBeCloseTo(0.865);
		expect(color.g).toBeCloseTo(0.235);
		expect(color.b).toBeCloseTo(0.235);
	});

	it("wraps negative and >360 hue the same way", () => {
		const a = Color.fromHsl(-30, 0.7, 0.55);
		const b = Color.fromHsl(330, 0.7, 0.55);
		expect(a.r).toBeCloseTo(b.r);
		expect(a.g).toBeCloseTo(b.g);
		expect(a.b).toBeCloseTo(b.b);
	});
});

describe("Color.toCss", () => {
	it("rounds and formats as rgb(...)", () => {
		expect(Color.fromJSON({ r: 1, g: 0.5, b: 0 }).toCss()).toBe(
			"rgb(255, 128, 0)",
		);
	});

	it("clamps out-of-range channels defensively", () => {
		expect(Color.fromJSON({ r: 1.5, g: -0.5, b: 0.5 }).toCss()).toBe(
			"rgb(255, 0, 128)",
		);
	});
});

describe("Color.toJSON / fromJSON", () => {
	it("round-trips through the plain-object wire shape", () => {
		const original = Color.fromHex("#336699");
		const json = original.toJSON();
		const restored = Color.fromJSON(json);
		expect(restored.toJSON()).toEqual(json);
	});
});
