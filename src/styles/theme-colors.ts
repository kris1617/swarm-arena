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
export const BOID_FILL_COLOR = "#38bdf8";
// Warm tone (red/orange family) contrasting with the cool blue BOID_FILL_COLOR
// against CANVAS_BACKGROUND — a "predator = danger" visual convention, paired
// with a distinct shape (not color alone) for robustness, including for
// colorblind users.
export const PREDATOR_FILL_COLOR = "#f97316";
