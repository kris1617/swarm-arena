// parameter-suggestion-heuristic Phase 1: a plain, framework-free
// correlation/selection function so it's unit-testable without a DB or
// session — same discipline this project's lessons.md already established
// for `run-export.ts` (the plain formatter behind the Route Handler) and
// `watchServerRun` (the plain generator behind the `watch` subscription).
// See `src/server/api/routers/simulation.ts`'s `getParameterSuggestion` for
// the thin tRPC query that fetches rows and delegates here.

import {
	TOP_LEVEL_RANGED_PARAMETER_NAMES,
	type TopLevelRangedParameterName,
} from "~/server/simulation/parameter-ranges";

// per-tribe-behavior-weights Phase 1: narrowed from the full
// `RangedParameterName` to `TopLevelRangedParameterName` — this heuristic
// correlates a completed run's SCORE against its own top-level scalar
// fields; the six new per-tribe fields (`parameter-ranges.ts`'s
// `TRIBE_RANGED_FIELD_NAMES`) live inside `tribeConfigs[]`, not as a single
// scalar per run, so they're out of scope for this suggestion heuristic as
// it exists today (no change requested to extend it here).
export type SuggestionInputRow = {
	score: number;
} & Record<TopLevelRangedParameterName, number | boolean>;

export type ParameterSuggestion =
	| { status: "insufficient-data" }
	| {
			status: "ok";
			parameter: TopLevelRangedParameterName;
			direction: "increase" | "decrease";
			correlation: number; // -1..1
			sampleSize: number;
			confidence: "low" | "medium" | "high";
			rationale: string;
	  };

// Exact field labels from `src/app/simulation/page.tsx`'s staging form —
// verified against that file during plan-review so the same parameter is
// named identically in the form and in this rationale.
const PARAMETER_LABELS: Record<TopLevelRangedParameterName, string> = {
	boidCount: "Boid count",
	separationWeight: "Separation weight",
	alignmentWeight: "Alignment weight",
	cohesionWeight: "Cohesion weight",
	maxDurationSeconds: "Max duration (seconds)",
	predatorCount: "Predator count",
	protectionThreshold: "Protection threshold",
	foodStockInitial: "Initial food stock",
	foodRegenRate: "Food regen rate",
	flockCount: "Flock count",
	crossbreedingEnabled: "Crossbreeding enabled",
	energyThreshold: "Energy threshold",
	mutationChance: "Mutation chance",
	mutationMagnitude: "Mutation magnitude",
	xyArea: "Area size",
	zDepth: "Depth size",
};

const MIN_SAMPLE_SIZE = 3;

// Pearson correlation coefficient between two equal-length numeric series.
// Returns `null` when either series has zero variance (undefined
// correlation) rather than NaN from a 0/0 division.
function pearsonCorrelation(xs: number[], ys: number[]): number | null {
	const n = xs.length;
	let sumX = 0;
	let sumY = 0;
	let sumXY = 0;
	let sumX2 = 0;
	let sumY2 = 0;
	for (let i = 0; i < n; i++) {
		const x = xs[i] as number;
		const y = ys[i] as number;
		sumX += x;
		sumY += y;
		sumXY += x * y;
		sumX2 += x * x;
		sumY2 += y * y;
	}
	const numerator = n * sumXY - sumX * sumY;
	const denominator = Math.sqrt(
		(n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY),
	);
	if (denominator === 0) {
		return null;
	}
	return numerator / denominator;
}

function confidenceFor(
	absCorrelation: number,
	sampleSize: number,
): "low" | "medium" | "high" {
	if (absCorrelation >= 0.7 && sampleSize >= 5) {
		return "high";
	}
	if (absCorrelation >= 0.4) {
		return "medium";
	}
	return "low";
}

function buildRationale(
	parameter: TopLevelRangedParameterName,
	direction: "increase" | "decrease",
	correlation: number,
	sampleSize: number,
	throttledCount?: number,
): string {
	const label = PARAMETER_LABELS[parameter];
	const qualifier = direction === "increase" ? "higher" : "lower";
	const base = `Across your last ${sampleSize} runs, ${qualifier} ${label} correlated with a better score (r = ${correlation.toFixed(2)}).`;
	// unwatched-run-tick-throttling Phase 3: flag-and-include decision —
	// throttled runs still feed the correlation input, but the rationale
	// discloses how many so the statistical skew is visible, not hidden.
	if (throttledCount && throttledCount > 0) {
		return `${base} (includes ${throttledCount} run(s) ticked at an accelerated rate while unwatched.)`;
	}
	return base;
}

export function suggestParameterChange(
	rows: SuggestionInputRow[],
	throttledCount?: number,
): ParameterSuggestion {
	if (rows.length < MIN_SAMPLE_SIZE) {
		return { status: "insufficient-data" };
	}

	const scores = rows.map((row) => row.score);

	let best: {
		parameter: TopLevelRangedParameterName;
		correlation: number;
	} | null = null;

	for (const name of TOP_LEVEL_RANGED_PARAMETER_NAMES) {
		const values = rows.map((row) => Number(row[name]));
		const firstValue = values[0];
		const hasVariance = values.some((value) => value !== firstValue);
		if (!hasVariance) {
			continue;
		}

		const correlation = pearsonCorrelation(values, scores);
		if (correlation === null || Number.isNaN(correlation)) {
			continue;
		}

		if (best === null || Math.abs(correlation) > Math.abs(best.correlation)) {
			best = { parameter: name, correlation };
		}
	}

	if (best === null) {
		return { status: "insufficient-data" };
	}

	const sampleSize = rows.length;
	const direction: "increase" | "decrease" =
		best.correlation >= 0 ? "increase" : "decrease";
	const confidence = confidenceFor(Math.abs(best.correlation), sampleSize);

	return {
		status: "ok",
		parameter: best.parameter,
		direction,
		correlation: best.correlation,
		sampleSize,
		confidence,
		rationale: buildRationale(
			best.parameter,
			direction,
			best.correlation,
			sampleSize,
			throttledCount,
		),
	};
}
