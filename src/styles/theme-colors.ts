// Canvas-readable mirror of the color values in globals.css. `<canvas>`
// drawing (`ctx.fillStyle = ...`) can't read a CSS custom property or a
// Tailwind class, so these two values exist as plain JS constants instead.
// Keep this file in sync with globals.css by hand — no build-time codegen
// is introduced for a single-view change.
//
// CANVAS_BACKGROUND is deliberately its own value, not globals.css's
// --background — the canvas has always used a distinct, slightly lighter
// slate backdrop (#1e293b) to contrast against the page's own background
// (#15162c), and this change preserves that existing visual distinction
// rather than merging the two.
export const CANVAS_BACKGROUND = "#1e293b";
// BOID_FILL_COLOR/PREDATOR_FILL_COLOR are re-exported from
// src/server/simulation/seed-colors.ts (the simulation engine's own
// source of truth for these two values — see that file's comment) rather
// than hand-duplicated here. Warm tone (red/orange family) contrasting
// with the cool blue boid color against CANVAS_BACKGROUND — a
// "predator = danger" visual convention, paired with a distinct shape (not
// color alone) for robustness, including for colorblind users.
export {
	BOID_SEED_COLOR as BOID_FILL_COLOR,
	// simulation-entity-shape-color-differentiation Phase 3: food's own
	// universal seed color, re-exported the same way as the two below.
	FOOD_SEED_COLOR as FOOD_FILL_COLOR,
	PREDATOR_SEED_COLOR as PREDATOR_FILL_COLOR,
} from "~/server/simulation/seed-colors";
// S-24 Phase 3: canvas-readable mirror of --border (oklch(1 0 0 / 20%) —
// white at 20% opacity), the same subtle line this canvas's own CSS border
// already uses via the `border-border/20` Tailwind class. Used for the
// world's wrap-boundary indicator and the minimap's own frame — chrome, not
// content, so it stays subtle rather than competing with entities.
export const CANVAS_BORDER_COLOR = "rgba(255, 255, 255, 0.2)";
// A brighter variant of the same --foreground white (oklch(1 0 0) =
// #ffffff), used only for the minimap's viewport-position rectangle, which
// needs to stay legible against moving entities rather than blend in as
// chrome the way CANVAS_BORDER_COLOR does.
export const CANVAS_HIGHLIGHT_COLOR = "rgba(255, 255, 255, 0.6)";
