// color (domain-distillation ACL follow-up): the bare {r,g,b} shape was
// independently reconstructed in boids.ts (hex-parsing) and
// simulation-canvas.tsx (CSS-string construction), each with its own
// clamping/rounding logic. This class is the sole owner of both
// conversions. See context/domain/03-anti-corruption-layer.md.
//
// Deliberately does NOT include a `blend` method: boids.ts's per-channel
// blend during crossbreeding (`blendChannel`) reuses the genetics system's
// shared mutation-aware `blendNumber` (rng + mutationChance +
// mutationMagnitude), the same function used for every other heritable
// numeric gene. That is genetics logic applied to color channels, not a
// pure color operation — moving it here would couple this value object to
// the crossbreeding engine for no benefit, so it stays in boids.ts.
//
// BoidGenes.color keeps the bare {r,g,b} type (unchanged) rather than
// becoming Color in-memory: genes round-trip through a JSON history column
// and the tRPC wire, and only JSON.stringify (not every deserializer)
// invokes a custom toJSON automatically. Threading the class through every
// read site would risk a plain object reaching code that expects Color's
// methods. Call sites convert at the boundary instead: `Color.fromHex(...)
// .toJSON()`, `Color.fromJSON(color).toCss()`.

export type ColorJSON = { r: number; g: number; b: number };

export class Color {
	private constructor(
		readonly r: number,
		readonly g: number,
		readonly b: number,
	) {}

	// The ONLY place that knows the "#rrggbb" hex wire format.
	static fromHex(hex: string): Color {
		const value = hex.replace("#", "");
		return new Color(
			Number.parseInt(value.slice(0, 2), 16) / 255,
			Number.parseInt(value.slice(2, 4), 16) / 255,
			Number.parseInt(value.slice(4, 6), 16) / 255,
		);
	}

	// The ONLY place that knows the HSL->RGB math.
	static fromHsl(
		hueDegrees: number,
		saturation: number,
		lightness: number,
	): Color {
		const h = ((hueDegrees % 360) + 360) % 360;
		const c = (1 - Math.abs(2 * lightness - 1)) * saturation;
		const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
		const m = lightness - c / 2;
		let r = 0;
		let g = 0;
		let b = 0;
		if (h < 60) {
			r = c;
			g = x;
		} else if (h < 120) {
			r = x;
			g = c;
		} else if (h < 180) {
			g = c;
			b = x;
		} else if (h < 240) {
			g = x;
			b = c;
		} else if (h < 300) {
			r = x;
			b = c;
		} else {
			r = c;
			b = x;
		}
		return new Color(r + m, g + m, b + m);
	}

	// The ONLY place that knows the CSS rgb(...) wire format and its
	// clamping/rounding rule.
	toCss(): string {
		const toChannel = (value: number) =>
			Math.round(Math.min(1, Math.max(0, value)) * 255);
		return `rgb(${toChannel(this.r)}, ${toChannel(this.g)}, ${toChannel(this.b)})`;
	}

	// Plain-object escape hatch for persistence/wire serialization ONLY.
	toJSON(): ColorJSON {
		return { r: this.r, g: this.g, b: this.b };
	}

	static fromJSON(json: ColorJSON): Color {
		return new Color(json.r, json.g, json.b);
	}
}
