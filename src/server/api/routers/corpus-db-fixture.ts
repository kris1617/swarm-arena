// analytics-correctness-corpus-tests Phase 1: inserts the real, committed
// 20-run parameter-sweep corpus (`loadCorpusFixture()`) as completed
// (`status: "stopped"`) `simulationRuns` rows under one synthetic owner, so
// later phases can call the real procedures (e.g. `getRunAnalysis`) against
// real primary keys instead of re-deriving analysis from in-memory fixture
// data. Reuses the exact insertion shape `simulation.test.ts`'s own
// `getRunAnalysis` tests already establish (a `users` row, then a
// `simulationRuns` row with `...VALID_START_INPUT`-equivalent params plus
// `seed`/`status`/`score`/`history`) — this change introduces no new
// DB-row-shape convention.
import { eq } from "drizzle-orm";

import { simulationRuns, users } from "~/server/db/schema";
import { loadCorpusFixture } from "~/server/simulation/corpus-fixture";
import type { DB } from "../../../../scripts/corpus/harness";

export type InsertedCorpusRun = { sweepIndex: number; runId: number };

// Deliberately does NOT start with "corpus-" — `scripts/corpus/
// generate-sweep.ts` and its smoke test both run
// `db.delete(users).where(like(users.email, "corpus-%@example.com"))`
// against the same SQLite file in the default test suite, and SQL
// `LIKE 'corpus-%@example.com'` is a substring match on the whole prefix,
// so any `corpus-*`-prefixed email would also be swept up by that cleanup.
function ownerEmail(): string {
	return `db-fixture-${crypto.randomUUID()}@example.com`;
}

// Inserts one synthetic owner plus all 20 corpus runs as completed
// `simulationRuns` rows, keyed back to each row's real `sweepIndex`.
// Deliberately does NOT run a defensive "delete stray prior rows" pass —
// `ownerEmail()`'s random UUID already makes every call collision-proof
// against a prior crashed run's leftovers, and several of this change's
// test files call this concurrently under Vitest's default file
// parallelism; a blanket prefix-based delete here previously raced across
// those files (one file's delete could wipe another's still-in-use
// owner+rows mid-test, confirmed via a reproducible SQLITE_CONSTRAINT_
// FOREIGNKEY failure — impl-review F1). Every caller already cleans up
// its own owner via `cleanupCorpusDbFixture`.
export async function insertCorpusRunsAsCompleted(
	db: DB,
): Promise<{ ownerId: string; runs: InsertedCorpusRun[] }> {
	const [owner] = await db
		.insert(users)
		.values({ email: ownerEmail() })
		.returning({ id: users.id });
	if (!owner) {
		throw new Error(
			"insertCorpusRunsAsCompleted: failed to insert fixture owner",
		);
	}

	const corpus = loadCorpusFixture();
	const runs: InsertedCorpusRun[] = [];

	for (const row of corpus) {
		const [run] = await db
			.insert(simulationRuns)
			.values({
				userId: owner.id,
				// Required — NOT NULL with no DB default, and not part of
				// `StartCorpusRunParams`/`CorpusFixtureRow.params`. The row's
				// own `sweepIndex` is a convenient, deterministic per-row
				// value.
				seed: row.sweepIndex,
				...row.params,
				status: "stopped",
				score: row.score,
				history: row.history,
			})
			.returning({ id: simulationRuns.id });
		if (!run) {
			throw new Error(
				`insertCorpusRunsAsCompleted: failed to insert run for sweepIndex ${row.sweepIndex}`,
			);
		}
		runs.push({ sweepIndex: row.sweepIndex, runId: run.id });
	}

	return { ownerId: owner.id, runs };
}

// Deletes the synthetic owner row — cascade-deletes its `simulationRuns`
// rows via the existing `userId` FK (`onDelete: "cascade"`, same as every
// other owner-scoped fixture cleanup in this project).
export async function cleanupCorpusDbFixture(
	db: DB,
	ownerId: string,
): Promise<void> {
	await db.delete(users).where(eq(users.id, ownerId));
}
