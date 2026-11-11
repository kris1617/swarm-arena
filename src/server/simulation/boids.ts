export type BoidState = {
	x: number;
	y: number;
	z: number;
	vx: number;
	vy: number;
	vz: number;
	lifespan: number;
};

export type FlockWeights = {
	separation: number;
	alignment: number;
	cohesion: number;
};

// Side length of the square area initial positions are spread over.
const INITIAL_AREA_SIZE = 200;
// Depth of the volume initial z positions are spread over. Sized comparably
// to INITIAL_AREA_SIZE so the simulation volume is roughly cubic rather than
// a thin 2D slab with an awkwardly large or small z range.
const Z_DEPTH_RANGE = 200;
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

function distance(
	a: { x: number; y: number; z: number },
	b: { x: number; y: number; z: number },
) {
	return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

export function createInitialPopulation(
	count: number,
	rng: () => number,
	maxLifespan: number,
): BoidState[] {
	return Array.from({ length: count }, () => ({
		x: rng() * INITIAL_AREA_SIZE,
		y: rng() * INITIAL_AREA_SIZE,
		z: rng() * Z_DEPTH_RANGE,
		vx: (rng() - 0.5) * INITIAL_SPEED,
		vy: (rng() - 0.5) * INITIAL_SPEED,
		vz: (rng() - 0.5) * INITIAL_SPEED,
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
			const dz = b.z - a.z;
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
			a.x -= (nx * overlap) / 2;
			a.y -= (ny * overlap) / 2;
			a.z -= (nz * overlap) / 2;
			b.x += (nx * overlap) / 2;
			b.y += (ny * overlap) / 2;
			b.z += (nz * overlap) / 2;
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
		let sepSumZ = 0;
		let sepCount = 0;
		let neighborCount = 0;
		let sumVx = 0;
		let sumVy = 0;
		let sumVz = 0;
		let sumX = 0;
		let sumY = 0;
		let sumZ = 0;

		for (const other of boids) {
			if (other === boid) {
				continue;
			}
			const dx = boid.x - other.x;
			const dy = boid.y - other.y;
			const dz = boid.z - other.z;
			const dist = Math.hypot(dx, dy, dz);
			if (dist > NEIGHBOR_RADIUS) {
				continue;
			}

			neighborCount++;
			sumVx += other.vx;
			sumVy += other.vy;
			sumVz += other.vz;
			sumX += other.x;
			sumY += other.y;
			sumZ += other.z;

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
			const avgX = sumX / neighborCount;
			const avgY = sumY / neighborCount;
			const avgZ = sumZ / neighborCount;
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

			const rawCohX = avgX - boid.x;
			const rawCohY = avgY - boid.y;
			const rawCohZ = avgZ - boid.z;
			const cohMag = Math.hypot(rawCohX, rawCohY, rawCohZ);
			if (cohMag > 0) {
				cohesionX = rawCohX / cohMag;
				cohesionY = rawCohY / cohMag;
				cohesionZ = rawCohZ / cohMag;
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
		const steeredVz =
			boid.vz +
			(separationZ * weights.separation +
				alignmentZ * weights.alignment +
				cohesionZ * weights.cohesion) *
				STEERING_FORCE_SCALE *
				dtSeconds;

		// Steering only changes heading; speed is clamped to a cruise range
		// every tick so boids keep moving regardless of how small or large
		// the net steering force happened to be this frame.
		const speed = Math.hypot(steeredVx, steeredVy, steeredVz);
		const clampedSpeed = Math.min(Math.max(speed, MIN_SPEED), MAX_SPEED);
		const vx = speed > 0 ? (steeredVx / speed) * clampedSpeed : clampedSpeed;
		const vy = speed > 0 ? (steeredVy / speed) * clampedSpeed : 0;
		const vz = speed > 0 ? (steeredVz / speed) * clampedSpeed : 0;

		return {
			x: boid.x + vx * dtSeconds,
			y: boid.y + vy * dtSeconds,
			z: boid.z + vz * dtSeconds,
			vx,
			vy,
			vz,
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
	const centroidZ = boids.reduce((sum, boid) => sum + boid.z, 0) / boids.length;
	const averageDistance =
		boids.reduce(
			(sum, boid) =>
				sum + distance(boid, { x: centroidX, y: centroidY, z: centroidZ }),
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
