// post-run-optimization-suggestion Phase 1: a plain, framework-free
// diagnosis function so it's unit-testable without a DB or session — same
// discipline this project's lessons.md already established for
// `parameter-suggestion.ts` (the pure function behind the cross-run
// suggestion), `run-export.ts`, and `watchServerRun`. See
// `src/server/api/routers/simulation.ts`'s `getRunAnalysis` for the thin
// call site that reads a run's own `phaseHistory` and delegates here.
//
// Distinct from `parameter-suggestion.ts`'s `suggestParameterChange`: that
// function correlates a parameter against score across many past runs;
// this one reasons about a single run's own phase trajectory and needs no
// run history beyond itself (FR-027, PRD Socratic resolution against
// FR-015).

import type { PopulationPhase } from "~/server/simulation/boids";

export type RunOptimizationSuggestion =
	| { status: "insufficient-data" }
	| { status: "ok"; dominantPhase: PopulationPhase; rationale: string };

const MIN_SAMPLE_SIZE = 10;

// Tie-break order when two phases have equal counts: the more severe issue
// is more useful to surface than an arbitrary pick.
const SEVERITY_ORDER: PopulationPhase[] = [
	"crash",
	"overshoot",
	"establishment",
	"growth",
	"recovery",
];

function findDominantPhase(phaseHistory: PopulationPhase[]): PopulationPhase {
	const counts: Record<PopulationPhase, number> = {
		establishment: 0,
		growth: 0,
		overshoot: 0,
		crash: 0,
		recovery: 0,
	};
	for (const phase of phaseHistory) {
		counts[phase] += 1;
	}

	let dominant: PopulationPhase = "establishment";
	let dominantCount = -1;
	for (const phase of SEVERITY_ORDER) {
		const count = counts[phase];
		if (count > dominantCount) {
			dominant = phase;
			dominantCount = count;
		}
	}
	return dominant;
}

function buildRationale(
	dominantPhase: PopulationPhase,
	input: {
		predatorCount: number;
		foodStockInitial: number;
		foodRegenRate: number;
	},
): string {
	switch (dominantPhase) {
		case "crash":
			return `This run spent most of its time in Crash — consider raising initial food stock (currently ${input.foodStockInitial}) or lowering predator count (currently ${input.predatorCount}) next time.`;
		case "overshoot":
			return `This run spent most of its time in Overshoot, meaning the population outgrew its food supply — consider raising food regen rate (currently ${input.foodRegenRate}) or lowering boid count next time.`;
		case "establishment":
			return "This run spent most of its time in Establishment and never got going — try a longer max duration, or lower predator count to give the population more room to establish.";
		case "growth":
		case "recovery":
			return `This run spent most of its time in ${dominantPhase === "growth" ? "Growth" : "Recovery"} — the population was thriving. No parameter changes needed.`;
	}
}

export function suggestRunOptimization(input: {
	phaseHistory: PopulationPhase[];
	predatorCount: number;
	foodStockInitial: number;
	foodRegenRate: number;
}): RunOptimizationSuggestion {
	if (input.phaseHistory.length < MIN_SAMPLE_SIZE) {
		return { status: "insufficient-data" };
	}

	const dominantPhase = findDominantPhase(input.phaseHistory);
	const rationale = buildRationale(dominantPhase, input);

	return { status: "ok", dominantPhase, rationale };
}
