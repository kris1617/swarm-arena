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
// Boids within this radius influence alignment and cohesion.
const NEIGHBOR_RADIUS = 50;
// Boids within this (smaller) radius trigger separation steering.
const SEPARATION_RADIUS = 20;
// Distance at which computeCohesion bottoms out at 0; keeps the metric
// independent of canvas size.
const COHESION_REFERENCE_RADIUS = 100;

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

export function stepBoids(
	boids: BoidState[],
	weights: FlockWeights,
	dtSeconds: number,
): BoidState[] {
	return boids
		.map((boid) => {
			const neighbors = boids.filter(
				(other) => other !== boid && distance(boid, other) <= NEIGHBOR_RADIUS,
			);
			const closeNeighbors = neighbors.filter(
				(other) => distance(boid, other) <= SEPARATION_RADIUS,
			);

			let separationX = 0;
			let separationY = 0;
			for (const neighbor of closeNeighbors) {
				const dx = boid.x - neighbor.x;
				const dy = boid.y - neighbor.y;
				const dist = Math.hypot(dx, dy);
				if (dist > 0) {
					separationX += dx / dist;
					separationY += dy / dist;
				}
			}
			if (closeNeighbors.length > 0) {
				separationX /= closeNeighbors.length;
				separationY /= closeNeighbors.length;
			}

			let alignmentX = 0;
			let alignmentY = 0;
			let cohesionX = 0;
			let cohesionY = 0;
			if (neighbors.length > 0) {
				let sumVx = 0;
				let sumVy = 0;
				let sumX = 0;
				let sumY = 0;
				for (const neighbor of neighbors) {
					sumVx += neighbor.vx;
					sumVy += neighbor.vy;
					sumX += neighbor.x;
					sumY += neighbor.y;
				}
				const avgVx = sumVx / neighbors.length;
				const avgVy = sumVy / neighbors.length;
				const avgX = sumX / neighbors.length;
				const avgY = sumY / neighbors.length;
				alignmentX = avgVx - boid.vx;
				alignmentY = avgVy - boid.vy;
				cohesionX = avgX - boid.x;
				cohesionY = avgY - boid.y;
			}

			const vx =
				boid.vx +
				(separationX * weights.separation +
					alignmentX * weights.alignment +
					cohesionX * weights.cohesion) *
					dtSeconds;
			const vy =
				boid.vy +
				(separationY * weights.separation +
					alignmentY * weights.alignment +
					cohesionY * weights.cohesion) *
					dtSeconds;

			return {
				x: boid.x + vx * dtSeconds,
				y: boid.y + vy * dtSeconds,
				vx,
				vy,
				lifespan: boid.lifespan - dtSeconds,
			};
		})
		.filter((boid) => boid.lifespan > 0);
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
