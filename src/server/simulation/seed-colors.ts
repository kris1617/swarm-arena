// Single source of truth for the two hex values boids.ts seeds flock 0's
// color from (createFlockColors in boids.ts). These live here, not in
// src/styles/theme-colors.ts, because the simulation engine is their
// primary consumer — this is fundamentally simulation seed data (part of
// each individual's deterministic, rng-driven genes) that also happens to
// be reused for canvas rendering, not UI/presentation data that happens to
// be reused for simulation. theme-colors.ts re-exports these two under
// their prior names (BOID_FILL_COLOR/PREDATOR_FILL_COLOR) so the client
// canvas renderer keeps a stable import.
export const BOID_SEED_COLOR = "#38bdf8";
export const PREDATOR_SEED_COLOR = "#f97316";
// simulation-entity-shape-color-differentiation Phase 3: food has no `genes`
// and is not tribe-tagged, so it gets one universal color constant (no
// genetics/tribe drift) rather than a per-entity seed. Green, distinct from
// the cyan-blue boid and orange predator seed colors above.
export const FOOD_SEED_COLOR = "#22c55e";
