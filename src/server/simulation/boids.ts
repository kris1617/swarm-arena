export type BoidState = {
	x: number;
	y: number;
	vx: number;
	vy: number;
	lifespan: number;
};

export type FlockWeights = {
	separation: number;
	alignment: number;
	cohesion: number;
};

// Side length of the square area initial positions are spread over.
const INITIAL_AREA_SIZE = 200;
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

function distance(a: { x: number; y: number }, b: { x: number; y: number }) {
	return Math.hypot(a.x - b.x, a.y - b.y);
}

export function createInitialPopulation(
	count: number,
	rng: () => number,
	maxLifespan: number,
): BoidState[] {
	return Array.from({ length: count }, () => ({
		x: rng() * INITIAL_AREA_SIZE,
		y: rng() * INITIAL_AREA_SIZE,
		vx: (rng() - 0.5) * INITIAL_SPEED,
		vy: (rng() - 0.5) * INITIAL_SPEED,
		lifespan: maxLifespan,
	}));
}

// Direct positional correction, applied once after every boid has moved:
// for any pair still closer than MIN_SEPARATION_DISTANCE, push them apart
// along the line between them until exactly that far apart. This is a hard
// constraint, not a tunable force — it cannot be outweighed by cohesion
// regardless of weights, unlike the steering forces above.
function resolveOverlaps(boids: BoidState[]): BoidState[] {
	const resolved = boids.map((boid) => ({ ...boid }));
	for (let i = 0; i < resolved.length; i++) {
		for (let j = i + 1; j < resolved.length; j++) {
			const a = resolved[i];
			const b = resolved[j];
			if (!a || !b) {
				continue;
			}
			const dx = b.x - a.x;
			const dy = b.y - a.y;
			const dist = Math.hypot(dx, dy);
			if (dist >= MIN_SEPARATION_DISTANCE) {
				continue;
			}
			// Exact overlap (dist === 0) has no defined direction to push
			// along; fall back to a fixed axis so the pair still separates
			// instead of staying stuck at zero distance forever.
			const nx = dist > 0 ? dx / dist : 1;
			const ny = dist > 0 ? dy / dist : 0;
			const overlap = MIN_SEPARATION_DISTANCE - dist;
			a.x -= (nx * overlap) / 2;
			a.y -= (ny * overlap) / 2;
			b.x += (nx * overlap) / 2;
			b.y += (ny * overlap) / 2;
		}
	}
	return resolved;
}

export function stepBoids(
	boids: BoidState[],
	weights: FlockWeights,
	dtSeconds: number,
): BoidState[] {
	const stepped = boids.map((boid) => {
		// Single O(n) pass per boid instead of two separate `.filter()` calls
		// (each re-running `distance()` and allocating a throwaway array) —
		// distance to each other boid is computed exactly once and reused for
		// both the neighbor and close-neighbor checks below.
		let sepSumX = 0;
		let sepSumY = 0;
		let sepCount = 0;
		let neighborCount = 0;
		let sumVx = 0;
		let sumVy = 0;
		let sumX = 0;
		let sumY = 0;

		for (const other of boids) {
			if (other === boid) {
				continue;
			}
			const dx = boid.x - other.x;
			const dy = boid.y - other.y;
			const dist = Math.hypot(dx, dy);
			if (dist > NEIGHBOR_RADIUS) {
				continue;
			}

			neighborCount++;
			sumVx += other.vx;
			sumVy += other.vy;
			sumX += other.x;
			sumY += other.y;

			if (dist <= SEPARATION_RADIUS && dist > 0) {
				sepSumX += dx / dist;
				sepSumY += dy / dist;
				sepCount++;
			}
		}

		const separationX = sepCount > 0 ? sepSumX / sepCount : 0;
		const separationY = sepCount > 0 ? sepSumY / sepCount : 0;

		let alignmentX = 0;
		let alignmentY = 0;
		let cohesionX = 0;
		let cohesionY = 0;
		if (neighborCount > 0) {
			const avgVx = sumVx / neighborCount;
			const avgVy = sumVy / neighborCount;
			const avgX = sumX / neighborCount;
			const avgY = sumY / neighborCount;
			// Normalized to unit vectors, same as separation above, so no
			// steering force's magnitude scales with raw distance/speed —
			// otherwise cohesion (unbounded with distance) structurally
			// overwhelms separation (bounded ~1) and the flock collapses
			// to a single point instead of reaching a stable spacing.
			const rawAlignX = avgVx - boid.vx;
			const rawAlignY = avgVy - boid.vy;
			const alignMag = Math.hypot(rawAlignX, rawAlignY);
			if (alignMag > 0) {
				alignmentX = rawAlignX / alignMag;
				alignmentY = rawAlignY / alignMag;
			}

			const rawCohX = avgX - boid.x;
			const rawCohY = avgY - boid.y;
			const cohMag = Math.hypot(rawCohX, rawCohY);
			if (cohMag > 0) {
				cohesionX = rawCohX / cohMag;
				cohesionY = rawCohY / cohMag;
			}
		}

		const steeredVx =
			boid.vx +
			(separationX * weights.separation +
				alignmentX * weights.alignment +
				cohesionX * weights.cohesion) *
				STEERING_FORCE_SCALE *
				dtSeconds;
		const steeredVy =
			boid.vy +
			(separationY * weights.separation +
				alignmentY * weights.alignment +
				cohesionY * weights.cohesion) *
				STEERING_FORCE_SCALE *
				dtSeconds;

		// Steering only changes heading; speed is clamped to a cruise range
		// every tick so boids keep moving regardless of how small or large
		// the net steering force happened to be this frame.
		const speed = Math.hypot(steeredVx, steeredVy);
		const clampedSpeed = Math.min(Math.max(speed, MIN_SPEED), MAX_SPEED);
		const vx = speed > 0 ? (steeredVx / speed) * clampedSpeed : clampedSpeed;
		const vy = speed > 0 ? (steeredVy / speed) * clampedSpeed : 0;

		return {
			x: boid.x + vx * dtSeconds,
			y: boid.y + vy * dtSeconds,
			vx,
			vy,
			lifespan: boid.lifespan - dtSeconds,
		};
	});

	return resolveOverlaps(stepped).filter((boid) => boid.lifespan > 0);
}

export function computeCohesion(boids: BoidState[]): number {
	if (boids.length === 0) {
		return 1;
	}

	const centroidX = boids.reduce((sum, boid) => sum + boid.x, 0) / boids.length;
	const centroidY = boids.reduce((sum, boid) => sum + boid.y, 0) / boids.length;
	const averageDistance =
		boids.reduce(
			(sum, boid) => sum + distance(boid, { x: centroidX, y: centroidY }),
			0,
		) / boids.length;

	const cohesion = 1 - averageDistance / COHESION_REFERENCE_RADIUS;
	return Math.max(0, Math.min(1, cohesion));
}

export function computeScore(
	cohesionSamples: number[],
	elapsedTicks: number,
): number {
	const average =
		cohesionSamples.length > 0
			? cohesionSamples.reduce((sum, sample) => sum + sample, 0) /
				cohesionSamples.length
			: 0;

	return elapsedTicks * average;
}
