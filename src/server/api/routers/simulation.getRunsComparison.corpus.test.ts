// analytics-correctness-corpus-tests Phase 3: proves getRunsComparison's own
// wiring (ownership/status gates, per-row error markers, `breakdown`
// assembly) against real data for a representative set of run pairs,
// without re-proving each primitive's correctness — that's Phase 2's job.
// Inserts the corpus once via Phase 1's insertCorpusRunsAsCompleted(), then
// it.each's over 3 representative sweepIndex pairs (extinction-vs-extinction,
// extinction-vs-success, success-vs-success) chosen from the known corpus
// facts verified during planning: sweepIndex 1 and 5 are both
// extinction-ended (score 0), sweepIndex 1 and 2 are extinction-vs-success,
// and sweepIndex 2 and 4 are both success (scores 938.3 and 2788.6).
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createCaller } from "~/server/api/root";
import { db } from "~/server/db";
import {
	cleanupCorpusDbFixture,
	type InsertedCorpusRun,
	insertCorpusRunsAsCompleted,
} from "./corpus-db-fixture";

const SWEEP_INDEX_PAIRS: ReadonlyArray<[number, number]> = [
	[1, 5], // extinction vs extinction
	[1, 2], // extinction vs success
	[2, 4], // success vs success
];

describe("simulationRouter.getRunsComparison against the real corpus", () => {
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

	it.each(SWEEP_INDEX_PAIRS)(
		"returns a well-formed comparison for sweepIndex pair [%i, %i]",
		async (sweepIndexA, sweepIndexB) => {
			const runIds = [sweepIndexA, sweepIndexB].map((sweepIndex) => {
				const inserted = runs.find((r) => r.sweepIndex === sweepIndex);
				if (!inserted) {
					throw new Error(
						`no inserted corpus row for sweepIndex ${sweepIndex}`,
					);
				}
				return inserted.runId;
			});

			const caller = createCaller({
				db,
				headers: new Headers(),
				allowSelfElevation: false,
				session: {
					user: { id: ownerId, role: "member" as const, elevatedUntil: null },
					expires: new Date(Date.now() + 60_000).toISOString(),
				},
			});

			const result = await caller.simulation.getRunsComparison({ runIds });

			expect(result).toHaveLength(2);

			for (const row of result) {
				expect("error" in row).toBe(false);
				if ("error" in row) {
					continue;
				}

				expect(row.breakdown).not.toBeNull();
				if (!row.breakdown) {
					continue;
				}

				expect(typeof row.breakdown.survival).toBe("number");

				expect(row.breakdown.resourceManagement).toBeGreaterThanOrEqual(0);
				expect(row.breakdown.resourceManagement).toBeLessThanOrEqual(1);

				expect(row.breakdown.geneticDiversity).toBeGreaterThanOrEqual(0);
				expect(row.breakdown.geneticDiversity).toBeLessThanOrEqual(1);

				expect(row.breakdown.phaseQuality).toBeGreaterThanOrEqual(0);
				expect(row.breakdown.phaseQuality).toBeLessThanOrEqual(1);

				expect(
					row.breakdown.areaPopulationDensity === null ||
						typeof row.breakdown.areaPopulationDensity === "number",
				).toBe(true);
			}
		},
	);
});
