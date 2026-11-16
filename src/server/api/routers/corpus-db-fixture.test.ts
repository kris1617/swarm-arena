// analytics-correctness-corpus-tests Phase 1's own proof of correctness:
// insert the real 20-run corpus as completed DB rows, verify the round
// trip against the real corpus data, then verify cleanup leaves nothing
// behind.
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { db } from "~/server/db";
import { users } from "~/server/db/schema";
import { loadCorpusFixture } from "~/server/simulation/corpus-fixture";
import {
	cleanupCorpusDbFixture,
	insertCorpusRunsAsCompleted,
} from "./corpus-db-fixture";

describe("corpus-db-fixture", () => {
	// 20 sequential inserts against the real SQLite file comfortably exceed
	// Vitest's default 5s per-test timeout — same reasoning as this
	// project's other multi-row DB fixture tests, just scoped to this one
	// slow round trip instead of raised globally.
	it("inserts all 20 corpus runs as completed rows with real scores, then cleans up fully", async () => {
		const corpus = loadCorpusFixture();
		const scoreBySweepIndex = new Map(
			corpus.map((row) => [row.sweepIndex, row.score]),
		);

		const { ownerId, runs } = await insertCorpusRunsAsCompleted(db);

		try {
			expect(runs).toHaveLength(20);
			expect(new Set(runs.map((r) => r.sweepIndex))).toEqual(
				new Set(Array.from({ length: 20 }, (_, i) => i + 1)),
			);

			for (const { sweepIndex, runId } of runs) {
				const row = await db.query.simulationRuns.findFirst({
					where: (t, { eq: eqFn }) => eqFn(t.id, runId),
				});
				if (!row) {
					throw new Error(`expected a simulationRuns row for runId ${runId}`);
				}
				expect(row.status).toBe("stopped");
				expect(row.score).toBe(scoreBySweepIndex.get(sweepIndex));
			}
		} finally {
			await cleanupCorpusDbFixture(db, ownerId);
		}

		const remainingRuns = await db.query.simulationRuns.findMany({
			where: (t, { inArray }) =>
				inArray(
					t.id,
					runs.map((r) => r.runId),
				),
		});
		expect(remainingRuns).toHaveLength(0);

		const remainingOwner = await db
			.select({ id: users.id })
			.from(users)
			.where(eq(users.id, ownerId));
		expect(remainingOwner).toHaveLength(0);
	}, 30_000);
});
