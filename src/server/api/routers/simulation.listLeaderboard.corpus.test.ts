// analytics-correctness-corpus-tests Phase 4: proves listLeaderboard
// correctly orders all 20 real corpus runs by score and correctly derives
// `scoredWithAreaFactor` for every one of them — ordering and area-factor
// derivation that Phase 2 (getRunAnalysis) and Phase 3 (getRunsComparison)
// don't cover. Inserts the corpus once via Phase 1's
// insertCorpusRunsAsCompleted(), then asserts on the single listLeaderboard
// call's full 20-row result rather than per-pair comparisons, since the
// risk here is the full-set ordering and derivation, not any one row.
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createCaller } from "~/server/api/root";
import { db } from "~/server/db";
import {
	cleanupCorpusDbFixture,
	type InsertedCorpusRun,
	insertCorpusRunsAsCompleted,
} from "./corpus-db-fixture";

describe("simulationRouter.listLeaderboard against the real corpus", () => {
	let ownerId: string;
	let runs: InsertedCorpusRun[];

	// 20 sequential inserts against the real SQLite file comfortably
	// exceed Vitest's default 5s per-test timeout — same reasoning as
	// corpus-db-fixture.test.ts's own insertion test.
	beforeAll(async () => {
		const inserted = await insertCorpusRunsAsCompleted(db);
		ownerId = inserted.ownerId;
		runs = inserted.runs;
	}, 45_000);

	afterAll(async () => {
		await cleanupCorpusDbFixture(db, ownerId);
	});

	it("orders all 20 corpus runs by score and derives scoredWithAreaFactor for each", async () => {
		void runs;

		const caller = createCaller({
			db,
			headers: new Headers(),
			allowSelfElevation: false,
			session: {
				user: { id: ownerId, role: "member" as const, elevatedUntil: null },
				expires: new Date(Date.now() + 60_000).toISOString(),
			},
		});

		const result = await caller.simulation.listLeaderboard();

		expect(result).toHaveLength(20);

		const scores = result.map((row) => row.score);
		for (let i = 0; i < scores.length - 1; i++) {
			expect(scores[i]).toBeGreaterThanOrEqual(scores[i + 1] ?? Number.NaN);
		}

		for (const row of result) {
			expect(row.scoredWithAreaFactor).toBe(true);
		}
	});
});
