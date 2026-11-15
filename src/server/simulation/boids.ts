import { buildSpatialGrid } from "~/server/simulation/spatial-grid";
import { BOID_FILL_COLOR, PREDATOR_FILL_COLOR } from "~/styles/theme-colors";

export type FlockWeights = {
	separation: number;
	alignment: number;
	cohesion: number;
};

// Per-individual heritable traits an individual is born with and may pass to
// offspring (reproduction arrives in Phase 2 via `inheritGenes` below) — not
// the transient per-tick state (position/velocity/lifespan) BoidState/
// PredatorState also carry. `separationWeight`/`alignmentWeight`/
// `cohesionWeight` replace the population-wide FlockWeights stepBoids used to
// read, and `maxSpeed`/`minSpeed` replace the global MAX_SPEED/MIN_SPEED (or
// PREDATOR_MAX_SPEED/PREDATOR_MIN_SPEED) constants — both are now sourced per
// individual so siblings with different genes steer differently.
export type BoidGenes = {
	color: { r: number; g: number; b: number };
	flockId: number;
	separationWeight: number;
	alignmentWeight: number;
	cohesionWeight: number;
	maxSpeed: number;
	minSpeed: number;
	maxLifespan: number;
	matePreference: number;
};

export type BoidState = {
	x: number;
	y: number;
	z: number;
	vx: number;
	vy: number;
	vz: number;
	lifespan: number;
	genes: BoidGenes;
	energy: number;
	age: number;
	gender: "a" | "b";
};

// Same shape as BoidGenes — predators inherit and mutate genes through the
// identical `inheritGenes` helper (one shared reproduction rule for both
// species per decision #5, not two parallel implementations), same rationale
// as the BoidState/PredatorState shape-identity comment below.
export type PredatorGenes = BoidGenes;

// Same shape as BoidState — predators carry no hunger field of their own
// (hunger is a global food-stock mechanic that only ever acts on boids this
// slice; predators die only from natural lifespan expiry).
export type PredatorState = {
	x: number;
	y: number;
	z: number;
	vx: number;
	vy: number;
	vz: number;
	lifespan: number;
	genes: PredatorGenes;
	energy: number;
	age: number;
	gender: "a" | "b";
};

// S-24: the simulation's spatial extent, threaded explicitly into every
// function below that used to read the module-private INITIAL_AREA_SIZE/
// Z_DEPTH_RANGE constants by name — x/y both carry the run's configured
// `xyArea`, z carries `zDepth`. No default: a caller that forgets to thread
// the run's real configured value must fail loudly, not silently fall back
// to some baked-in size.
export type WorldSize = { x: number; y: number; z: number };

// Max magnitude of each initial velocity component.
const INITIAL_SPEED = 2;
// Boids within this radius influence alignment and cohesion. Sized relative
// to MAX_SPEED so a boid doesn't out-fly its own sensing range tick to tick.
const NEIGHBOR_RADIUS = 70;
// Boids within this (smaller) radius trigger separation steering.
const SEPARATION_RADIUS = 25;
// Distance at which computeCohesion bottoms out at 0; keeps the metric
// independent of canvas size.
const COHESION_REFERENCE_RADIUS = 100;
// Hard floor: no two boids are ever allowed to end a tick closer than this,
// enforced by direct positional correction below — not a steering force a
// boid can be outweighed into ignoring (unlike SEPARATION_RADIUS's unit-
// vector push, whose magnitude doesn't grow as distance shrinks).
const MIN_SEPARATION_DISTANCE = 4;
// Cruise-speed bounds applied after steering every tick. Unit-vector steering
// forces are tiny relative to dt, so without a floor boids settle near their
// (also tiny) initial random velocity and barely move — this keeps motion
// lively regardless of how steering nets out, the standard Reynolds-boids fix.
const MIN_SPEED = 15;
const MAX_SPEED = 40;
// Steering forces are unit vectors (magnitude ~1); scaled by this before dt
// so a boid cruising at MIN_SPEED-MAX_SPEED can actually be redirected within
// a few ticks instead of the steering nudge being negligible next to speed.
const STEERING_FORCE_SCALE = 120;
// Predator cruise-speed bounds — deliberately faster than boids' MIN_SPEED/
// MAX_SPEED (15-40) so a predator can actually close the gap on a fleeing
// boid instead of hunting being invisible.
const PREDATOR_MIN_SPEED = 20;
const PREDATOR_MAX_SPEED = 55;
// Distance at which a predator captures the nearest boid in applyPredation.
// Sized just above MIN_SEPARATION_DISTANCE (so capture needs real contact,
// not just proximity) and well below SEPARATION_RADIUS.
const CAPTURE_RADIUS = 6;
// Distance at which a boid starts fleeing the nearest predator in stepBoids.
// Sized between SEPARATION_RADIUS and NEIGHBOR_RADIUS so flee steering kicks
// in before a predator is close enough to threaten capture, but isn't
// triggered by every distant predator in the simulation.
const PREDATOR_DETECTION_RADIUS = 50;
// Fixed engine constant (not a user-tunable FlockWeights field, same class
// as STEERING_FORCE_SCALE) — weights flee steering strongly enough to
// override normal flocking so a nearby predator visibly scatters a flock.
const FLEE_WEIGHT = 2;
// Food-stock units consumed per boid per second of simulated time.
const FOOD_CONSUMPTION_PER_BOID = 0.5;
// Extra lifespan decay (units/second) applied to every boid, layered on top
// of stepBoids' unconditional per-tick decay, only while food stock is
// negative — FR-008 treats hunger as an accelerant on the existing death
// mechanism, never a separate, independent death check.
const HUNGER_EXTRA_DECAY_RATE = 1;
// Starting energy for a freshly spawned individual (initial population or,
// from Phase 2 on, a newborn) — well under ENERGY_MAX so reproduction
// eligibility (a future run-level energyThreshold param) isn't trivially
// satisfied at spawn.
const INITIAL_ENERGY = 20;
// Ceiling on accumulated energy — see ENERGY_GAIN_RATE's comment for how this
// and INITIAL_ENERGY bound the time needed to reach a mid-range
// energyThreshold.
// Exported ahead of Phase 2's `reproducePopulation`, which is the actual
// consumer of this and the three constants below — kept as plain exports
// rather than underscore-prefixed unused locals so the name Phase 2 imports
// is already the name declared here.
export const ENERGY_MAX = 100;
// Energy gained per second of simulated time by a surviving individual
// (Phase 2 wires the per-tick increment). Chosen so an individual starting at
// INITIAL_ENERGY reaches ENERGY_MAX in (100-20)/10 = 8 seconds — comfortably
// within MATURITY_AGE_SECONDS and a typical run's multi-ten-second duration,
// so a reasonable mid-range energyThreshold (the future run-level param,
// not yet wired) is reachable within a run without reproduction being either
// instant or practically unreachable.
export const ENERGY_GAIN_RATE = 10;
// Tick-based maturity delay before an individual becomes reproduction-
// eligible (Phase 2 reads this). Small relative to typical maxDurationSeconds
// (tens of seconds or more) so reproduction is actually reachable within a
// run, not just a theoretical gate.
export const MATURITY_AGE_SECONDS = 5;
// Distance within which two eligible individuals can mate (Phase 2). Sized
// in the same ballpark as SEPARATION_RADIUS (25) / NEIGHBOR_RADIUS (70) so
// mating range tracks the same "nearby" notion the rest of the engine uses.
export const MATE_DISTANCE_RADIUS = 30;

// Wraps a coordinate into [0, range) — toroidal boundaries, so a boid that
// exits one edge re-enters from the opposite one instead of drifting off
// into open space indefinitely.
function wrap(value: number, range: number): number {
	const wrapped = value % range;
	return wrapped < 0 ? wrapped + range : wrapped;
}

// Minimum-image convention: the shortest signed delta between two wrapped
// coordinates, considering that going "the other way" around the torus may
// be shorter than the raw difference. Without this, a boid that just wrapped
// across the seam appears ~`range` units away to its actual (still adjacent)
// neighbors, repeatedly disrupting separation/alignment/cohesion every time
// any boid crosses an edge over a long run.
function wrappedDelta(delta: number, range: number): number {
	const halfRange = range / 2;
	if (delta > halfRange) {
		return delta - range;
	}
	if (delta < -halfRange) {
		return delta + range;
	}
	return delta;
}

// Wrapped midpoint between two parents on the torus (reproducePopulation's
// spawn position) — same minimum-image reasoning as wrappedDelta above: the
// raw arithmetic mean of two coordinates straddling a wrap seam lands
// nowhere near either parent, so this walks the shortest wrapped delta from
// `a` toward `b` and halves it instead.
function wrappedMidpoint(a: number, b: number, range: number): number {
	return wrap(a + wrappedDelta(b - a, range) / 2, range);
}

// Converts a "#rrggbb" hex string into unit-interval [0,1] RGB.
// BOID_FILL_COLOR/PREDATOR_FILL_COLOR (src/styles/theme-colors.ts) are plain
// hex strings for canvas's ctx.fillStyle, while BoidGenes.color stays in
// [0,1] like the rest of this module's normalized math, so flock 0 can seed
// from them exactly.
function hexToUnitColor(hex: string): { r: number; g: number; b: number } {
	const value = hex.replace("#", "");
	return {
		r: Number.parseInt(value.slice(0, 2), 16) / 255,
		g: Number.parseInt(value.slice(2, 4), 16) / 255,
		b: Number.parseInt(value.slice(4, 6), 16) / 255,
	};
}

// Standard HSL->RGB conversion, output in [0,1] to match hexToUnitColor.
// Used to spread flocks 1..N-1 evenly around the color wheel so N flocks
// stay visually distinguishable regardless of flockCount.
function hslToUnitColor(
	hueDegrees: number,
	saturation: number,
	lightness: number,
): { r: number; g: number; b: number } {
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
	return { r: r + m, g: g + m, b: b + m };
}

// Saturation/lightness held fixed across flocks 1..N-1 — hue is the only
// thing that varies, so the even hue spread below is the sole distinguishing
// factor between them.
const FLOCK_COLOR_SATURATION = 0.7;
const FLOCK_COLOR_LIGHTNESS = 0.55;

// Standard RGB->hue extraction (degrees), used so the hue spread below can
// start from flock 0's ACTUAL hue rather than a fixed 0°. BOID_FILL_COLOR's
// hue is ~198° — spreading flocks 1..N-1 from 0° independently of that (e.g.
// flockCount=2 landing flock 1 at exactly 180°) put flock 1 only 18° away
// from flock 0 on the color wheel, visually near-identical. Anchoring the
// spread at flock 0's own hue guarantees maximal, even angular separation
// for any flockCount in [2,4] regardless of where the seed color happens to
// sit.
function rgbToHueDegrees({
	r,
	g,
	b,
}: {
	r: number;
	g: number;
	b: number;
}): number {
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const delta = max - min;
	if (delta === 0) {
		return 0;
	}
	let hue: number;
	if (max === r) {
		hue = ((g - b) / delta) % 6;
	} else if (max === g) {
		hue = (b - r) / delta + 2;
	} else {
		hue = (r - g) / delta + 4;
	}
	hue *= 60;
	return hue < 0 ? hue + 360 : hue;
}

// Flock 0 reuses `seedColorHex` (BOID_FILL_COLOR/PREDATOR_FILL_COLOR) for
// continuity with the pre-genetics engine; flocks 1..N-1 get hues evenly
// spread around the color wheel, anchored at flock 0's own hue (see
// rgbToHueDegrees above), so any flockCount in [2,4] (decision #1) stays
// visually distinguishable.
function createFlockColors(
	flockCount: number,
	seedColorHex: string,
): Array<{ r: number; g: number; b: number }> {
	const seedColor = hexToUnitColor(seedColorHex);
	const seedHue = rgbToHueDegrees(seedColor);
	return Array.from({ length: flockCount }, (_, flockId) =>
		flockId === 0
			? seedColor
			: hslToUnitColor(
					seedHue + (360 / flockCount) * flockId,
					FLOCK_COLOR_SATURATION,
					FLOCK_COLOR_LIGHTNESS,
				),
	);
}

// Splits `count` individuals evenly across `flockCount` flocks, remainder
// going to the first N flocks (decision #1: flock membership fixed at spawn,
// split evenly).
function splitCountAcrossFlocks(count: number, flockCount: number): number[] {
	const base = Math.floor(count / flockCount);
	const remainder = count % flockCount;
	return Array.from({ length: flockCount }, (_, flockId) =>
		flockId < remainder ? base + 1 : base,
	);
}

// Each boid's genes seed from its flock's FlockWeights exactly (FR-006: "the
// flock defines only the average values individuals start from") — no
// variance at gen 0; mutation only happens at birth via reproduction
// (Phase 2's `inheritGenes`), never at initial seeding.
export function createInitialPopulation(
	count: number,
	rng: () => number,
	maxLifespan: number,
	flockCount: number,
	flockWeights: FlockWeights[],
	worldSize: WorldSize,
): BoidState[] {
	const countsPerFlock = splitCountAcrossFlocks(count, flockCount);
	const colors = createFlockColors(flockCount, BOID_FILL_COLOR);
	const boids: BoidState[] = [];
	for (let flockId = 0; flockId < flockCount; flockId++) {
		const weights = flockWeights[flockId];
		const color = colors[flockId];
		if (!weights || !color) {
			continue;
		}
		const flockSize = countsPerFlock[flockId] ?? 0;
		for (let i = 0; i < flockSize; i++) {
			boids.push({
				x: rng() * worldSize.x,
				y: rng() * worldSize.y,
				z: rng() * worldSize.z,
				vx: (rng() - 0.5) * INITIAL_SPEED,
				vy: (rng() - 0.5) * INITIAL_SPEED,
				vz: (rng() - 0.5) * INITIAL_SPEED,
				lifespan: maxLifespan,
				genes: {
					color,
					flockId,
					separationWeight: weights.separation,
					alignmentWeight: weights.alignment,
					cohesionWeight: weights.cohesion,
					maxSpeed: MAX_SPEED,
					minSpeed: MIN_SPEED,
					maxLifespan,
					matePreference: rng(),
				},
				energy: INITIAL_ENERGY,
				age: 0,
				gender: rng() < 0.5 ? "a" : "b",
			});
		}
	}
	return boids;
}

// Symmetric with createInitialPopulation per decision #5 — predators get
// flocks/genes/energy/age/gender too, no "simpler" predator path.
export function createInitialPredators(
	count: number,
	rng: () => number,
	maxLifespan: number,
	flockCount: number,
	flockWeights: FlockWeights[],
	worldSize: WorldSize,
): PredatorState[] {
	const countsPerFlock = splitCountAcrossFlocks(count, flockCount);
	const colors = createFlockColors(flockCount, PREDATOR_FILL_COLOR);
	const predators: PredatorState[] = [];
	for (let flockId = 0; flockId < flockCount; flockId++) {
		const weights = flockWeights[flockId];
		const color = colors[flockId];
		if (!weights || !color) {
			continue;
		}
		const flockSize = countsPerFlock[flockId] ?? 0;
		for (let i = 0; i < flockSize; i++) {
			predators.push({
				x: rng() * worldSize.x,
				y: rng() * worldSize.y,
				z: rng() * worldSize.z,
				vx: (rng() - 0.5) * INITIAL_SPEED,
				vy: (rng() - 0.5) * INITIAL_SPEED,
				vz: (rng() - 0.5) * INITIAL_SPEED,
				lifespan: maxLifespan,
				genes: {
					color,
					flockId,
					separationWeight: weights.separation,
					alignmentWeight: weights.alignment,
					cohesionWeight: weights.cohesion,
					maxSpeed: PREDATOR_MAX_SPEED,
					minSpeed: PREDATOR_MIN_SPEED,
					maxLifespan,
					matePreference: rng(),
				},
				energy: INITIAL_ENERGY,
				age: 0,
				gender: rng() < 0.5 ? "a" : "b",
			});
		}
	}
	return predators;
}

// Direct positional correction, applied once after every boid has moved:
// for any pair still closer than MIN_SEPARATION_DISTANCE, push them apart
// along the line between them until exactly that far apart. This is a hard
// constraint, not a tunable force — it cannot be outweighed by cohesion
// regardless of weights, unlike the steering forces above.
function resolveOverlaps(
	boids: BoidState[],
	worldSize: WorldSize,
): BoidState[] {
	const resolved = boids.map((boid) => ({ ...boid }));
	for (let i = 0; i < resolved.length; i++) {
		for (let j = i + 1; j < resolved.length; j++) {
			const a = resolved[i];
			const b = resolved[j];
			if (!a || !b) {
				continue;
			}
			const dx = wrappedDelta(b.x - a.x, worldSize.x);
			const dy = wrappedDelta(b.y - a.y, worldSize.y);
			const dz = wrappedDelta(b.z - a.z, worldSize.z);
			const dist = Math.hypot(dx, dy, dz);
			if (dist >= MIN_SEPARATION_DISTANCE) {
				continue;
			}
			// Exact overlap (dist === 0) has no defined direction to push
			// along; fall back to a fixed axis so the pair still separates
			// instead of staying stuck at zero distance forever.
			const nx = dist > 0 ? dx / dist : 1;
			const ny = dist > 0 ? dy / dist : 0;
			const nz = dist > 0 ? dz / dist : 0;
			const overlap = MIN_SEPARATION_DISTANCE - dist;
			a.x = wrap(a.x - (nx * overlap) / 2, worldSize.x);
			a.y = wrap(a.y - (ny * overlap) / 2, worldSize.y);
			a.z = wrap(a.z - (nz * overlap) / 2, worldSize.z);
			b.x = wrap(b.x + (nx * overlap) / 2, worldSize.x);
			b.y = wrap(b.y + (ny * overlap) / 2, worldSize.y);
			b.z = wrap(b.z + (nz * overlap) / 2, worldSize.z);
		}
	}
	return resolved;
}

export function stepBoids(
	boids: BoidState[],
	dtSeconds: number,
	worldSize: WorldSize,
	predators: PredatorState[] = [],
): BoidState[] {
	// Built once from this tick's starting positions, before any boid's new
	// position is computed below — positions read through these grids are
	// never mutated mid-map (the `.map()` callback only ever reads `boids`/
	// `predators`, assembling a brand-new array), so a single snapshot grid
	// is safe here, unlike `resolveOverlaps` below (see its own comment).
	const boidGrid = buildSpatialGrid(
		boids,
		(b) => ({ x: b.x, y: b.y, z: b.z }),
		NEIGHBOR_RADIUS,
		worldSize,
	);
	const predatorGrid =
		predators.length > 0
			? buildSpatialGrid(
					predators,
					(p) => ({ x: p.x, y: p.y, z: p.z }),
					PREDATOR_DETECTION_RADIUS,
					worldSize,
				)
			: null;

	const stepped = boids.map((boid, boidIndex) => {
		// Single O(n) pass per boid instead of two separate `.filter()` calls
		// (each re-running `distance()` and allocating a throwaway array) —
		// distance to each other boid is computed exactly once and reused for
		// both the neighbor and close-neighbor checks below.
		let sepSumX = 0;
		let sepSumY = 0;
		let sepSumZ = 0;
		let sepCount = 0;
		let neighborCount = 0;
		let sumVx = 0;
		let sumVy = 0;
		let sumVz = 0;
		// Accumulated as wrapped *offsets from this boid* (not raw positions)
		// so averaging them is correct even when neighbors straddle a wrap
		// seam — averaging raw positions would be wrong on a torus the same
		// way averaging angles 359° and 1° as raw numbers gives 180°, not 0°.
		let sumDX = 0;
		let sumDY = 0;
		let sumDZ = 0;

		for (const otherIndex of boidGrid.queryRadius(
			{ x: boid.x, y: boid.y, z: boid.z },
			NEIGHBOR_RADIUS,
		)) {
			if (otherIndex === boidIndex) {
				continue;
			}
			const other = boids[otherIndex];
			if (!other) {
				continue;
			}
			const dx = wrappedDelta(boid.x - other.x, worldSize.x);
			const dy = wrappedDelta(boid.y - other.y, worldSize.y);
			const dz = wrappedDelta(boid.z - other.z, worldSize.z);
			const dist = Math.hypot(dx, dy, dz);
			if (dist > NEIGHBOR_RADIUS) {
				continue;
			}

			neighborCount++;
			sumVx += other.vx;
			sumVy += other.vy;
			sumVz += other.vz;
			sumDX += -dx;
			sumDY += -dy;
			sumDZ += -dz;

			if (dist <= SEPARATION_RADIUS && dist > 0) {
				sepSumX += dx / dist;
				sepSumY += dy / dist;
				sepSumZ += dz / dist;
				sepCount++;
			}
		}

		const separationX = sepCount > 0 ? sepSumX / sepCount : 0;
		const separationY = sepCount > 0 ? sepSumY / sepCount : 0;
		const separationZ = sepCount > 0 ? sepSumZ / sepCount : 0;

		let alignmentX = 0;
		let alignmentY = 0;
		let alignmentZ = 0;
		let cohesionX = 0;
		let cohesionY = 0;
		let cohesionZ = 0;
		if (neighborCount > 0) {
			const avgVx = sumVx / neighborCount;
			const avgVy = sumVy / neighborCount;
			const avgVz = sumVz / neighborCount;
			// Already offsets-from-boid (see sumDX/DY/DZ above), so this is
			// directly the raw cohesion vector — no further subtraction.
			const avgDX = sumDX / neighborCount;
			const avgDY = sumDY / neighborCount;
			const avgDZ = sumDZ / neighborCount;
			// Normalized to unit vectors, same as separation above, so no
			// steering force's magnitude scales with raw distance/speed —
			// otherwise cohesion (unbounded with distance) structurally
			// overwhelms separation (bounded ~1) and the flock collapses
			// to a single point instead of reaching a stable spacing.
			const rawAlignX = avgVx - boid.vx;
			const rawAlignY = avgVy - boid.vy;
			const rawAlignZ = avgVz - boid.vz;
			const alignMag = Math.hypot(rawAlignX, rawAlignY, rawAlignZ);
			if (alignMag > 0) {
				alignmentX = rawAlignX / alignMag;
				alignmentY = rawAlignY / alignMag;
				alignmentZ = rawAlignZ / alignMag;
			}

			const rawCohX = avgDX;
			const rawCohY = avgDY;
			const rawCohZ = avgDZ;
			const cohMag = Math.hypot(rawCohX, rawCohY, rawCohZ);
			if (cohMag > 0) {
				cohesionX = rawCohX / cohMag;
				cohesionY = rawCohY / cohMag;
				cohesionZ = rawCohZ / cohMag;
			}
		}

		// Flee steering: a unit vector pointing away from the nearest predator
		// within PREDATOR_DETECTION_RADIUS, weighted by the fixed FLEE_WEIGHT
		// constant so it can override normal flocking. No predators in range
		// (including the default empty `predators` array) leaves this at zero,
		// making behavior bit-for-bit identical to the pre-predator engine.
		let fleeX = 0;
		let fleeY = 0;
		let fleeZ = 0;
		let nearestPredatorDist = Infinity;
		let nearestPredatorDx = 0;
		let nearestPredatorDy = 0;
		let nearestPredatorDz = 0;
		for (const predatorIndex of predatorGrid?.queryRadius(
			{ x: boid.x, y: boid.y, z: boid.z },
			PREDATOR_DETECTION_RADIUS,
		) ?? []) {
			const predator = predators[predatorIndex];
			if (!predator) {
				continue;
			}
			const dx = wrappedDelta(boid.x - predator.x, worldSize.x);
			const dy = wrappedDelta(boid.y - predator.y, worldSize.y);
			const dz = wrappedDelta(boid.z - predator.z, worldSize.z);
			const dist = Math.hypot(dx, dy, dz);
			if (dist <= PREDATOR_DETECTION_RADIUS && dist < nearestPredatorDist) {
				nearestPredatorDist = dist;
				nearestPredatorDx = dx;
				nearestPredatorDy = dy;
				nearestPredatorDz = dz;
			}
		}
		if (
			nearestPredatorDist <= PREDATOR_DETECTION_RADIUS &&
			nearestPredatorDist > 0
		) {
			fleeX = nearestPredatorDx / nearestPredatorDist;
			fleeY = nearestPredatorDy / nearestPredatorDist;
			fleeZ = nearestPredatorDz / nearestPredatorDist;
		}

		const steeredVx =
			boid.vx +
			(separationX * boid.genes.separationWeight +
				alignmentX * boid.genes.alignmentWeight +
				cohesionX * boid.genes.cohesionWeight +
				fleeX * FLEE_WEIGHT) *
				STEERING_FORCE_SCALE *
				dtSeconds;
		const steeredVy =
			boid.vy +
			(separationY * boid.genes.separationWeight +
				alignmentY * boid.genes.alignmentWeight +
				cohesionY * boid.genes.cohesionWeight +
				fleeY * FLEE_WEIGHT) *
				STEERING_FORCE_SCALE *
				dtSeconds;
		const steeredVz =
			boid.vz +
			(separationZ * boid.genes.separationWeight +
				alignmentZ * boid.genes.alignmentWeight +
				cohesionZ * boid.genes.cohesionWeight +
				fleeZ * FLEE_WEIGHT) *
				STEERING_FORCE_SCALE *
				dtSeconds;

		// Steering only changes heading; speed is clamped to a cruise range
		// every tick so boids keep moving regardless of how small or large
		// the net steering force happened to be this frame. The clamp bounds
		// are now this boid's own genes.minSpeed/maxSpeed (seeded from the
		// engine's MIN_SPEED/MAX_SPEED at spawn) rather than the global
		// constants directly, so a mutated descendant can cruise outside the
		// range its ancestors started in.
		const speed = Math.hypot(steeredVx, steeredVy, steeredVz);
		const clampedSpeed = Math.min(
			Math.max(speed, boid.genes.minSpeed),
			boid.genes.maxSpeed,
		);
		const vx = speed > 0 ? (steeredVx / speed) * clampedSpeed : clampedSpeed;
		const vy = speed > 0 ? (steeredVy / speed) * clampedSpeed : 0;
		const vz = speed > 0 ? (steeredVz / speed) * clampedSpeed : 0;

		return {
			...boid,
			x: wrap(boid.x + vx * dtSeconds, worldSize.x),
			y: wrap(boid.y + vy * dtSeconds, worldSize.y),
			z: wrap(boid.z + vz * dtSeconds, worldSize.z),
			vx,
			vy,
			vz,
			lifespan: boid.lifespan - dtSeconds,
		};
	});

	return resolveOverlaps(stepped, worldSize).filter(
		(boid) => boid.lifespan > 0,
	);
}

// Each predator pursues its nearest living boid in a straight line (no
// separation/alignment/cohesion among predators — out of scope this slice),
// cruising within its own (faster) speed bounds and wrapping toroidally.
export function stepPredators(
	predators: PredatorState[],
	boids: BoidState[],
	dtSeconds: number,
	worldSize: WorldSize,
): PredatorState[] {
	const stepped = predators.map((predator) => {
		// A predator with no boids left to target holds its current heading
		// unsteered (steerX/Y/Z stay 0) rather than erroring.
		let steerX = 0;
		let steerY = 0;
		let steerZ = 0;
		let nearestDist = Infinity;
		let nearestDx = 0;
		let nearestDy = 0;
		let nearestDz = 0;
		for (const boid of boids) {
			const dx = wrappedDelta(boid.x - predator.x, worldSize.x);
			const dy = wrappedDelta(boid.y - predator.y, worldSize.y);
			const dz = wrappedDelta(boid.z - predator.z, worldSize.z);
			const dist = Math.hypot(dx, dy, dz);
			if (dist < nearestDist) {
				nearestDist = dist;
				nearestDx = dx;
				nearestDy = dy;
				nearestDz = dz;
			}
		}
		if (nearestDist > 0 && nearestDist !== Infinity) {
			steerX = nearestDx / nearestDist;
			steerY = nearestDy / nearestDist;
			steerZ = nearestDz / nearestDist;
		}

		const steeredVx = predator.vx + steerX * STEERING_FORCE_SCALE * dtSeconds;
		const steeredVy = predator.vy + steerY * STEERING_FORCE_SCALE * dtSeconds;
		const steeredVz = predator.vz + steerZ * STEERING_FORCE_SCALE * dtSeconds;

		const speed = Math.hypot(steeredVx, steeredVy, steeredVz);
		const clampedSpeed = Math.min(
			Math.max(speed, PREDATOR_MIN_SPEED),
			PREDATOR_MAX_SPEED,
		);
		const vx = speed > 0 ? (steeredVx / speed) * clampedSpeed : clampedSpeed;
		const vy = speed > 0 ? (steeredVy / speed) * clampedSpeed : 0;
		const vz = speed > 0 ? (steeredVz / speed) * clampedSpeed : 0;

		return {
			...predator,
			x: wrap(predator.x + vx * dtSeconds, worldSize.x),
			y: wrap(predator.y + vy * dtSeconds, worldSize.y),
			z: wrap(predator.z + vz * dtSeconds, worldSize.z),
			vx,
			vy,
			vz,
			lifespan: predator.lifespan - dtSeconds,
		};
	});

	return stepped.filter((predator) => predator.lifespan > 0);
}

// Arithmetic-mean blend of two parents' genes, with an independent mutation
// roll per numeric gene — the one helper Phase 2's `reproducePopulation` uses
// for both boids and predators (decision #5: one shared reproduction rule,
// not two parallel implementations). Pure and rng-driven so reproduction
// stays deterministic given the same rng stream.
export function inheritGenes(
	parentA: BoidGenes,
	parentB: BoidGenes,
	rng: () => number,
	mutationChance: number,
	mutationMagnitude: number,
): BoidGenes {
	// Independent roll per gene, not one roll for the whole genome — mirrors
	// real-world independent assortment, and keeps one gene mutating from
	// statistically correlating with any other gene mutating this birth.
	function blendNumber(a: number, b: number): number {
		const mean = (a + b) / 2;
		if (rng() < mutationChance) {
			return mean * (1 + (rng() * 2 - 1) * mutationMagnitude);
		}
		return mean;
	}

	// Same blend-then-maybe-mutate rule as blendNumber, with the result
	// clamped to [0,1] afterward — a channel's mean of two in-range parents
	// is already in range, but the multiplicative jitter above can push it
	// past either boundary.
	function blendChannel(a: number, b: number): number {
		return Math.min(1, Math.max(0, blendNumber(a, b)));
	}

	return {
		color: {
			r: blendChannel(parentA.color.r, parentB.color.r),
			g: blendChannel(parentA.color.g, parentB.color.g),
			b: blendChannel(parentA.color.b, parentB.color.b),
		},
		// Coin-flip, never blended — a crossbred offspring belongs to exactly
		// one flock, the field Phase 2's crossbreeding gate reads.
		flockId: rng() < 0.5 ? parentA.flockId : parentB.flockId,
		separationWeight: blendNumber(
			parentA.separationWeight,
			parentB.separationWeight,
		),
		alignmentWeight: blendNumber(
			parentA.alignmentWeight,
			parentB.alignmentWeight,
		),
		cohesionWeight: blendNumber(parentA.cohesionWeight, parentB.cohesionWeight),
		maxSpeed: blendNumber(parentA.maxSpeed, parentB.maxSpeed),
		minSpeed: blendNumber(parentA.minSpeed, parentB.minSpeed),
		maxLifespan: blendNumber(parentA.maxLifespan, parentB.maxLifespan),
		matePreference: blendNumber(parentA.matePreference, parentB.matePreference),
	};
}

// Phase 2's reproduction step: one generic helper used for BOTH boids and
// predators (decision #5 — identical rules, shared code, not two parallel
// implementations). Eligibility is energy + maturity; mate selection is
// first-match in population order (not scored), so results are deterministic
// given the same rng stream and population order. The population-cap guard
// is a silent no-op per decision #7 — a blocked pair still gets marked
// paired (no double-mating), it just produces no offspring.
export function reproducePopulation<T extends BoidState | PredatorState>(
	population: T[],
	rng: () => number,
	params: {
		crossbreedingEnabled: boolean;
		energyThreshold: number;
		mutationChance: number;
		mutationMagnitude: number;
		populationCap: number;
		totalOtherPopulationCount: number;
	},
	worldSize: WorldSize,
): { population: T[]; capped: boolean } {
	function isEligible(individual: T): boolean {
		return (
			individual.energy >= params.energyThreshold &&
			individual.age >= MATURITY_AGE_SECONDS
		);
	}

	const paired = new Set<number>();
	const offspring: T[] = [];
	let capped = false;

	// Positions are only ever read here, never mutated mid-scan (unlike
	// resolveOverlaps, which is why that function keeps its own plain
	// pairwise scan instead) — one snapshot grid for the whole call is safe.
	const mateGrid = buildSpatialGrid(
		population,
		(p) => ({ x: p.x, y: p.y, z: p.z }),
		MATE_DISTANCE_RADIUS,
		worldSize,
	);

	for (let i = 0; i < population.length; i++) {
		// Once the cap is reached, no further pair this tick can produce an
		// offspring (population.length/offspring.length/totalOtherPopulationCount
		// only grow), so stop the whole O(n²) scan immediately instead of still
		// running every remaining individual's inner mate-scan just to discard
		// the result (impl-review F2 — bounded perf, no behavior change: a
		// blocked pair's "mark both paired, no double-mating" bookkeeping is
		// never read after this function returns, so skipping it is safe).
		if (
			population.length + offspring.length + params.totalOtherPopulationCount >=
			params.populationCap
		) {
			capped = true;
			break;
		}
		if (paired.has(i)) {
			continue;
		}
		const parentA = population[i];
		if (!parentA || !isEligible(parentA)) {
			continue;
		}

		// First-match-in-range, scanning forward only (not the whole
		// population) — equivalent to a full bidirectional first-match scan
		// here because eligibility doesn't change mid-pass and the match
		// conditions are symmetric (see above). `queryRadius` always returns
		// candidate indices sorted ascending (see spatial-grid.ts), which is
		// exactly what makes "first match in this narrowed candidate set"
		// equal to "first match in the full population" below — iterating
		// an unsorted candidate set here would silently pick a different
		// mate than the pre-grid pairwise scan did for the same input.
		for (const j of mateGrid.queryRadius(
			{ x: parentA.x, y: parentA.y, z: parentA.z },
			MATE_DISTANCE_RADIUS,
		)) {
			if (j <= i || paired.has(j)) {
				continue;
			}
			const parentB = population[j];
			if (!parentB || !isEligible(parentB)) {
				continue;
			}
			if (parentA.gender === parentB.gender) {
				continue;
			}
			if (
				!params.crossbreedingEnabled &&
				parentA.genes.flockId !== parentB.genes.flockId
			) {
				continue;
			}
			const dx = wrappedDelta(parentA.x - parentB.x, worldSize.x);
			const dy = wrappedDelta(parentA.y - parentB.y, worldSize.y);
			const dz = wrappedDelta(parentA.z - parentB.z, worldSize.z);
			if (Math.hypot(dx, dy, dz) > MATE_DISTANCE_RADIUS) {
				continue;
			}

			// Match found — pair both parents this tick (no double-mating),
			// then stop scanning for parentA (first-match, not best-match).
			// The cap is already enforced by the outer loop's early-exit guard
			// above — if we reached here, we're still under cap.
			paired.add(i);
			paired.add(j);

			const genes = inheritGenes(
				parentA.genes,
				parentB.genes,
				rng,
				params.mutationChance,
				params.mutationMagnitude,
			);
			offspring.push({
				...parentA,
				x: wrappedMidpoint(parentA.x, parentB.x, worldSize.x),
				y: wrappedMidpoint(parentA.y, parentB.y, worldSize.y),
				z: wrappedMidpoint(parentA.z, parentB.z, worldSize.z),
				vx: (rng() - 0.5) * INITIAL_SPEED,
				vy: (rng() - 0.5) * INITIAL_SPEED,
				vz: (rng() - 0.5) * INITIAL_SPEED,
				lifespan: genes.maxLifespan,
				genes,
				energy: INITIAL_ENERGY,
				age: 0,
				gender: rng() < 0.5 ? "a" : "b",
			});
			break;
		}
	}

	return { population: [...population, ...offspring], capped };
}

// Maintains the single global food-stock number across ticks: depletes with
// population size, regenerates by the caller-supplied rate (one of the
// run's persisted parameters, not an engine constant), and — only when the
// resulting stock goes negative — applies an *extra* lifespan decay on top
// of stepBoids' unconditional per-tick decay. This is deliberately one
// death mechanism with an accelerant, not two independent ones (FR-008).
export function applyHunger(
	boids: BoidState[],
	foodStock: number,
	dtSeconds: number,
	foodRegenRate: number,
): { boids: BoidState[]; foodStock: number } {
	const depleted =
		foodStock - boids.length * FOOD_CONSUMPTION_PER_BOID * dtSeconds;
	const nextFoodStock = depleted + foodRegenRate * dtSeconds;

	if (nextFoodStock >= 0) {
		return { boids, foodStock: nextFoodStock };
	}

	const hungryBoids = boids
		.map((boid) => ({
			...boid,
			lifespan: boid.lifespan - HUNGER_EXTRA_DECAY_RATE * dtSeconds,
		}))
		.filter((boid) => boid.lifespan > 0);

	return { boids: hungryBoids, foodStock: nextFoodStock };
}

// The PRD's named US-01 acceptance criterion: a flock at or below the
// protection threshold is never attacked. Above the threshold, each
// predator captures its nearest boid within CAPTURE_RADIUS (instant kill,
// no cooldown/energy transfer this slice); a boid already captured by an
// earlier predator in the same tick cannot be captured again.
export function applyPredation(
	boids: BoidState[],
	predators: PredatorState[],
	protectionThreshold: number,
	worldSize: WorldSize,
): BoidState[] {
	if (boids.length <= protectionThreshold) {
		return boids;
	}

	// Cell size reuses NEIGHBOR_RADIUS (the largest radius queried against a
	// boid-population grid anywhere in this file), not CAPTURE_RADIUS itself
	// — same tradeoff the Lua reference accepts: a coarser-than-strictly-
	// needed grid returns some false-positive candidates per cell, still
	// exact-filtered below, in exchange for one shared cell-size convention.
	const boidGrid = buildSpatialGrid(
		boids,
		(b) => ({ x: b.x, y: b.y, z: b.z }),
		NEIGHBOR_RADIUS,
		worldSize,
	);

	const captured = new Set<BoidState>();
	for (const predator of predators) {
		let nearest: BoidState | null = null;
		let nearestDist = Infinity;
		for (const boidIndex of boidGrid.queryRadius(
			{ x: predator.x, y: predator.y, z: predator.z },
			CAPTURE_RADIUS,
		)) {
			const boid = boids[boidIndex];
			if (!boid || captured.has(boid)) {
				continue;
			}
			const dx = wrappedDelta(boid.x - predator.x, worldSize.x);
			const dy = wrappedDelta(boid.y - predator.y, worldSize.y);
			const dz = wrappedDelta(boid.z - predator.z, worldSize.z);
			const dist = Math.hypot(dx, dy, dz);
			if (dist <= CAPTURE_RADIUS && dist < nearestDist) {
				nearestDist = dist;
				nearest = boid;
			}
		}
		if (nearest) {
			captured.add(nearest);
		}
	}

	if (captured.size === 0) {
		return boids;
	}
	return boids.filter((boid) => !captured.has(boid));
}

// Composes the single-run pipeline's documented fixed per-tick order into one
// DOM-free, directly-testable entry point: stepBoids (flee steering reads
// this tick's predators) -> stepPredators -> applyHunger -> applyPredation ->
// [energy/age bump] -> reproducePopulation(boids) -> reproducePopulation
// (predators). Predation must run after both populations have moved this
// tick, using current-tick positions; hunger runs before predation so a
// boid that starved this tick is already removed and can't also be
// "captured" redundantly by the same tick's predation pass. Reproduction
// runs last, after this tick's deaths are already removed, so a boid that
// starved or was captured this tick cannot also reproduce. Mirrors
// simulation-canvas.tsx's inline tick sequence exactly so callers can switch
// to this function without changing behavior.
//
// `params.weights` (Phase 1's FlockWeights) is dropped from this signature —
// stepBoids has read each boid's own genes since Phase 1, so the field was
// already dead weight here; Phase 2 is this function's first real signature
// revision since then, so it's cleaned up now rather than carried further.
export function runTick(
	state: { boids: BoidState[]; predators: PredatorState[]; foodStock: number },
	params: {
		dtSeconds: number;
		foodRegenRate: number;
		protectionThreshold: number;
		rng: () => number;
		crossbreedingEnabled: boolean;
		energyThreshold: number;
		mutationChance: number;
		mutationMagnitude: number;
		populationCap: number;
		foodStockInitial: number;
		worldSize: WorldSize;
	},
): {
	boids: BoidState[];
	predators: PredatorState[];
	foodStock: number;
	populationCapped: boolean;
	// S-04 (FR-010 full): exposed for the "resource management" scoring
	// factor — this value was already computed below, just never returned.
	foodAvailabilityRatio: number;
} {
	const steeredBoids = stepBoids(
		state.boids,
		params.dtSeconds,
		params.worldSize,
		state.predators,
	);
	const steeredPredators = stepPredators(
		state.predators,
		steeredBoids,
		params.dtSeconds,
		params.worldSize,
	);
	const { boids: fedBoids, foodStock: nextFoodStock } = applyHunger(
		steeredBoids,
		state.foodStock,
		params.dtSeconds,
		params.foodRegenRate,
	);
	const predatedBoids = applyPredation(
		fedBoids,
		steeredPredators,
		params.protectionThreshold,
		params.worldSize,
	);

	// Every surviving individual gains energy and ages by dtSeconds this
	// tick. Boids' energy gain scales with food availability; predators have
	// no food-stock mechanic (see PredatorState's comment above), so their
	// ratio is fixed at 1.
	const foodAvailabilityRatio = Math.min(
		1,
		Math.max(0, nextFoodStock / params.foodStockInitial),
	);
	const agedBoids = predatedBoids.map((boid) => ({
		...boid,
		energy: Math.min(
			ENERGY_MAX,
			boid.energy + ENERGY_GAIN_RATE * params.dtSeconds * foodAvailabilityRatio,
		),
		age: boid.age + params.dtSeconds,
	}));
	const agedPredators = steeredPredators.map((predator) => ({
		...predator,
		energy: Math.min(
			ENERGY_MAX,
			predator.energy + ENERGY_GAIN_RATE * params.dtSeconds,
		),
		age: predator.age + params.dtSeconds,
	}));

	// params.populationCap is the combined FR-018 ceiling across both
	// species. Each reproducePopulation call enforces that combined ceiling
	// via `totalOtherPopulationCount` (the other species' live count at this
	// point in the tick) rather than by ALSO pre-subtracting populationCap
	// itself — doing both would double-count the other species and let the
	// combined population exceed the cap. Predators' call uses the
	// PRE-reproduction boid count (agedBoids.length, before boids' own
	// reproduction below runs) rather than the post-reproduction count —
	// simpler, and explicitly allowed by the plan.
	const { population: reproducedBoids, capped: boidsCapped } =
		reproducePopulation(
			agedBoids,
			params.rng,
			{
				crossbreedingEnabled: params.crossbreedingEnabled,
				energyThreshold: params.energyThreshold,
				mutationChance: params.mutationChance,
				mutationMagnitude: params.mutationMagnitude,
				populationCap: params.populationCap,
				totalOtherPopulationCount: agedPredators.length,
			},
			params.worldSize,
		);
	const { population: reproducedPredators, capped: predatorsCapped } =
		reproducePopulation(
			agedPredators,
			params.rng,
			{
				crossbreedingEnabled: params.crossbreedingEnabled,
				energyThreshold: params.energyThreshold,
				mutationChance: params.mutationChance,
				mutationMagnitude: params.mutationMagnitude,
				populationCap: params.populationCap,
				totalOtherPopulationCount: agedBoids.length,
			},
			params.worldSize,
		);

	return {
		boids: reproducedBoids,
		predators: reproducedPredators,
		foodStock: nextFoodStock,
		populationCapped: boidsCapped || predatorsCapped,
		foodAvailabilityRatio,
	};
}

// Circular mean: the correct way to average coordinates on a torus. A plain
// arithmetic mean breaks the moment a flock straddles the wrap seam — e.g.
// averaging 199 and 1 (two units apart through the seam) as raw numbers
// gives 100, nowhere near either boid. Mapping each value onto a circle
// (angle = value/range * 2π) and averaging there, then mapping back, gives
// the geometrically correct "middle" regardless of where the seam falls.
// Exported for the camera module (S-24 Phase 2): a camera centered on a
// population straddling the toroidal wrap seam needs the same circular-mean
// handling computeCohesion's centroid does below, not a plain arithmetic
// average.
export function circularMean(values: number[], range: number): number {
	let sumSin = 0;
	let sumCos = 0;
	for (const value of values) {
		const theta = (value / range) * 2 * Math.PI;
		sumSin += Math.sin(theta);
		sumCos += Math.cos(theta);
	}
	const avgSin = sumSin / values.length;
	const avgCos = sumCos / values.length;
	// Both land near 0 when values are symmetrically split around the torus
	// (e.g. a dispersed flock in two equal clusters half the range apart) —
	// without this guard, atan2 would return an angle dominated by
	// floating-point residue rather than a clean, deterministic tie-break.
	if (Math.hypot(avgSin, avgCos) < 1e-9) {
		return 0;
	}
	const meanTheta = Math.atan2(avgSin, avgCos);
	return wrap((meanTheta / (2 * Math.PI)) * range, range);
}

export function computeCohesion(
	boids: BoidState[],
	worldSize: WorldSize,
): number {
	if (boids.length === 0) {
		return 1;
	}

	const centroidX = circularMean(
		boids.map((boid) => boid.x),
		worldSize.x,
	);
	const centroidY = circularMean(
		boids.map((boid) => boid.y),
		worldSize.y,
	);
	const centroidZ = circularMean(
		boids.map((boid) => boid.z),
		worldSize.z,
	);
	const averageDistance =
		boids.reduce((sum, boid) => {
			const dx = wrappedDelta(boid.x - centroidX, worldSize.x);
			const dy = wrappedDelta(boid.y - centroidY, worldSize.y);
			const dz = wrappedDelta(boid.z - centroidZ, worldSize.z);
			return sum + Math.hypot(dx, dy, dz);
		}, 0) / boids.length;

	const cohesion = 1 - averageDistance / COHESION_REFERENCE_RADIUS;
	return Math.max(0, Math.min(1, cohesion));
}

// S-04 (FR-010 full, correctness fix): `computeCohesion` above measures
// spatial clustering, not gene-value spread — it reads zero gene fields,
// so it was a mislabeled stand-in for "genetic diversity" since S-01/S-03.
// This is the real metric: the coefficient of variation (stddev / mean,
// clamped into [0, 1]) of each heritable numeric gene field, averaged
// across fields. `computeCohesion` itself is unchanged and keeps whatever
// non-scoring role it has elsewhere (rendering is unaffected by this
// change) — only the scoring call site switches to this function.
const GENETIC_DIVERSITY_FIELDS = [
	"separationWeight",
	"alignmentWeight",
	"cohesionWeight",
	"maxSpeed",
	"minSpeed",
	"maxLifespan",
	"matePreference",
] as const satisfies readonly (keyof BoidGenes)[];

function coefficientOfVariation(values: number[]): number {
	if (values.length === 0) {
		return 0;
	}
	const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
	if (mean === 0) {
		return 0;
	}
	const variance =
		values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
	const stddev = Math.sqrt(variance);
	return Math.max(0, Math.min(1, stddev / mean));
}

// Takes gene arrays directly (not full BoidState) — diversity only ever
// reads `.genes`, and this is also exactly the minimal payload shape the
// client-staged path can send over `stop`'s mutation input without
// shipping full per-boid position/velocity/age/energy state it doesn't
// need for this calculation.
export function computeGeneticDiversity(genes: BoidGenes[]): number {
	if (genes.length === 0) {
		return 0;
	}
	const fieldDiversities = GENETIC_DIVERSITY_FIELDS.map((field) =>
		coefficientOfVariation(genes.map((g) => g[field])),
	);
	// Color channels (r/g/b, each already in [0,1]) contribute the same way
	// as the numeric gene fields above.
	const colorDiversities = (["r", "g", "b"] as const).map((channel) =>
		coefficientOfVariation(genes.map((g) => g.color[channel])),
	);
	const all = [...fieldDiversities, ...colorDiversities];
	return all.reduce((sum, v) => sum + v, 0) / all.length;
}

// S-04 (FR-019): the population-lifecycle phase model, resolved in the PRD
// as boom-bust/irruptive-growth (not the simpler logistic-growth curve,
// which has no crash phase) — this simulation's finite food + starvation +
// predation can genuinely crash a population.
export type PopulationPhase =
	| "establishment"
	| "growth"
	| "overshoot"
	| "crash"
	| "recovery";

const PHASE_WINDOW_SIZE = 20;
const OVERSHOOT_FOOD_RATIO_THRESHOLD = 0.3;
const CRASH_POPULATION_DROP_THRESHOLD = 0.1; // 10% decline over the window

export function classifyPopulationPhase(
	history: { populationCount: number; foodAvailabilityRatio: number }[],
	previousPhase: PopulationPhase | null,
): PopulationPhase {
	if (history.length < PHASE_WINDOW_SIZE) {
		return "establishment";
	}
	const window = history.slice(-PHASE_WINDOW_SIZE);
	const first = window[0];
	const last = window.at(-1);
	if (!first || !last) {
		return "establishment";
	}
	const populationTrend =
		first.populationCount > 0
			? (last.populationCount - first.populationCount) / first.populationCount
			: 0;
	const recentFoodRatio =
		window.reduce((sum, sample) => sum + sample.foodAvailabilityRatio, 0) /
		window.length;

	const isCrashing =
		populationTrend <= -CRASH_POPULATION_DROP_THRESHOLD &&
		recentFoodRatio < OVERSHOOT_FOOD_RATIO_THRESHOLD;
	if (isCrashing) {
		return "crash";
	}

	const isRecovering = previousPhase === "crash" && populationTrend >= 0;
	if (isRecovering) {
		return "recovery";
	}

	if (recentFoodRatio < OVERSHOOT_FOOD_RATIO_THRESHOLD) {
		return "overshoot";
	}

	return "growth";
}

// S-04 (FR-010 full): the per-phase quality weight time-averaged across a
// run's `phaseHistory`, used by `computePhaseQuality` below. Tuning
// values — rewards sustained health (growth, recovery) over crash, with
// overshoot/establishment as intermediate.
const PHASE_QUALITY_WEIGHTS: Record<PopulationPhase, number> = {
	establishment: 0.5,
	growth: 1.0,
	overshoot: 0.7,
	crash: 0.2,
	recovery: 0.9,
};

// Per-cycle resilience bonus step and cap (S-09, roadmap MS-06): each
// completed Crash -> Recovery cycle adds another step, with diminishing
// returns capped at RESILIENCE_BONUS_CAP_CYCLES — a population that
// survives several crashes and recovers each time scores higher than one
// that barely survives a single cycle, but endless crash-cycling doesn't
// get unbounded reward. 1 cycle reproduces this constant's pre-S-09
// magnitude (1 + 0.2 = 1.2) exactly, so the single-cycle case is unchanged.
// Clamped so the final value never exceeds 1.
const RESILIENCE_BONUS_STEP = 0.2;
const RESILIENCE_BONUS_CAP_CYCLES = 3;

// Finds non-overlapping Crash -> Recovery pairs in `phaseHistory`: scans
// forward for an unconsumed "crash" tick, then forward from there for the
// next "recovery" tick: if found, records the tick range and continues
// scanning from just past that recovery (so it can't be claimed by a
// later crash too), otherwise a trailing crash with no following recovery
// is an incomplete cycle and isn't recorded. Single forward pass, O(n).
// S-11 (MS-08): exported so the run-analysis-view can show the actual
// tick ranges, not just a count (`countCrashToRecoveryCycles` below is now
// a thin wrapper over this, same algorithm, no behavior change).
export function segmentCompletedCycles(
	phaseHistory: PopulationPhase[],
): { startTick: number; endTick: number }[] {
	const cycles: { startTick: number; endTick: number }[] = [];
	let i = 0;
	while (i < phaseHistory.length) {
		if (phaseHistory[i] !== "crash") {
			i++;
			continue;
		}
		const recoveryIndex = phaseHistory.indexOf("recovery", i + 1);
		if (recoveryIndex === -1) {
			break;
		}
		cycles.push({ startTick: i, endTick: recoveryIndex });
		i = recoveryIndex + 1;
	}
	return cycles;
}

function countCrashToRecoveryCycles(phaseHistory: PopulationPhase[]): number {
	return segmentCompletedCycles(phaseHistory).length;
}

export function computePhaseQuality(phaseHistory: PopulationPhase[]): number {
	if (phaseHistory.length === 0) {
		return 0;
	}
	const average =
		phaseHistory.reduce((sum, phase) => sum + PHASE_QUALITY_WEIGHTS[phase], 0) /
		phaseHistory.length;

	const cycles = countCrashToRecoveryCycles(phaseHistory);
	const bonusMultiplier =
		1 + RESILIENCE_BONUS_STEP * Math.min(cycles, RESILIENCE_BONUS_CAP_CYCLES);

	return Math.max(0, Math.min(1, average * bonusMultiplier));
}

export function computeResourceManagement(foodRatioSamples: number[]): number {
	if (foodRatioSamples.length === 0) {
		return 0;
	}
	return (
		foodRatioSamples.reduce((sum, sample) => sum + sample, 0) /
		foodRatioSamples.length
	);
}

// S-04 (FR-010 full): the real four-factor formula, replacing the
// 2-argument placeholder (`elapsedTicks * average(cohesionSamples)`).
// Deliberately takes four plain numbers rather than raw arrays — see
// `research.md`/`plan.md` Phase 3 item 5: both the server-owned path
// (which holds state locally) and the client-staged path (which sends its
// signals over `stop`'s mutation input) compute each factor from whatever
// state they hold, via the `compute*` helpers above, before calling this.
export function computeScore(
	elapsedTicks: number,
	resourceManagement: number,
	geneticDiversity: number,
	phaseQuality: number,
): number {
	return elapsedTicks * resourceManagement * geneticDiversity * phaseQuality;
}
