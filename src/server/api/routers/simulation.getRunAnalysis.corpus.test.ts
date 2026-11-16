// analytics-correctness-corpus-tests Phase 2: proves getRunAnalysis never
// throws and always returns a well-formed, plausible-range result across
// all 20 real corpus runs (loadCorpusFixture()), including the 4
// extinction-ended ones. Inserts the corpus once via Phase 1's
// insertCorpusRunsAsCompleted(), then it.each's over every sweepIndex
// against the SAME inserted corpus rather than re-inserting per case —
// loadCorpusFixture() is synchronous and DB-free, so the sweepIndex list
// for it.each is available at describe-body evaluation time, while the
// matching runId (only known once the DB insert in beforeAll resolves) is
// looked up inside each test body.
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createCaller } from "~/server/api/root";
import { db } from "~/server/db";
import type { PopulationPhase } from "~/server/simulation/boids";
import { loadCorpusFixture } from "~/server/simulation/corpus-fixture";
import {
	cleanupCorpusDbFixture,
	type InsertedCorpusRun,
	insertCorpusRunsAsCompleted,
} from "./corpus-db-fixture";

const POPULATION_PHASES: readonly PopulationPhase[] = [
	"establishment",
	"growth",
	"overshoot",
	"crash",
	"recovery",
];

const sweepIndexes = loadCorpusFixture().map((row) => row.sweepIndex);

describe("simulationRouter.getRunAnalysis against the real corpus", () => {
	let ownerId: string;
	let runs: InsertedCorpusRun[];

	// 20 sequential inserts against the real SQLite file comfortably
	// exceed Vitest's default 5s per-test timeout — same reasoning as
	// corpus-db-fixture.test.ts's own insertion test.
	beforeAll(async () => {
		const inserted = await insertCorpusRunsAsCompleted(db);
		ownerId = inserted.ownerId;
		runs = inserted.runs;
	}, 30_000);

	afterAll(async () => {
		await cleanupCorpusDbFixture(db, ownerId);
	});

	it.each(sweepIndexes)(
		"returns a well-formed, plausible-range analysis for sweepIndex %i",
		async (sweepIndex) => {
			const inserted = runs.find((r) => r.sweepIndex === sweepIndex);
			if (!inserted) {
				throw new Error(`no inserted corpus row for sweepIndex ${sweepIndex}`);
			}

			const caller = createCaller({
				db,
				headers: new Headers(),
				allowSelfElevation: false,
				session: {
					user: { id: ownerId, role: "member" as const, elevatedUntil: null },
					expires: new Date(Date.now() + 60_000).toISOString(),
				},
			});

			const result = await caller.simulation.getRunAnalysis({
				runId: inserted.runId,
			});

			expect(Array.isArray(result.completedCycles)).toBe(true);
			expect(result.finalGeneticDiversity).toBeGreaterThanOrEqual(0);
			expect(result.finalGeneticDiversity).toBeLessThanOrEqual(1);
			expect(["ok", "insufficient-data"]).toContain(
				result.runOptimizationSuggestion.status,
			);

			if (result.runOptimizationSuggestion.status === "ok") {
				expect(POPULATION_PHASES).toContain(
					result.runOptimizationSuggestion.dominantPhase,
				);
				expect(
					result.runOptimizationSuggestion.rationale.length,
				).toBeGreaterThan(0);
			}
		},
	);
});
