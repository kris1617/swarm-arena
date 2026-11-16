// parameter-sweep-corpus-generation Phase 3: batches `buildSweepMatrix()`'s
// ~20-row parameter matrix through the (batch-safe) harness built in Phase
// 1/2, 4 runs at a time, and exports each completed run to a JSON file plus
// one CSV index row. See this phase's plan for the batching/polling
// rationale; the real 20-row corpus this writes into
// `context/fixtures/parameter-sweep-corpus/` is Phase 4's job — this module
// is Phase 4's (and this phase's own smoke test's) entry point.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { eq, inArray, like } from "drizzle-orm";
import { vi } from "vitest";

import { adminSettings, simulationRuns, users } from "~/server/db/schema";
import {
	type CorpusRunRecord,
	collectAndCleanupCorpusRun,
	type DB,
	ensureAdminRangesAdmitForBatch,
	startCorpusRun,
} from "./harness";
import { buildSweepMatrix, type SweepRunParams } from "./sweep-matrix";

// Singleton row id for `adminSettings` — same deliberately-duplicated
// reference `harness.ts` already carries (that module has no exported
// constant this one could import instead).
const ADMIN_SETTINGS_ID = 1;

// 20 rows / 4 = exactly 5 batches for the real sweep — this orchestrator
// stays correct for any matrix length (the smoke test's 2-row matrix is one
// short batch).
const BATCH_SIZE = 4;

// Matches the granularity `harness.ts`'s own `callProcedure` assumes
// (`timingMiddleware`'s artificial delay) — coarse enough not to spin the
// loop needlessly, fine enough not to overshoot a short smoke-test
// duration by much.
const POLL_STEP_MS = 500;

// Safety margin above the batch's longest configured `maxDurationSeconds`
// so ordinary tick/scheduling jitter can't trip the ceiling on a run that
// is genuinely still progressing — while still bounding the loop so a run
// that never reaches `stopped` fails loudly instead of hanging forever.
// Widened from an initial 3x after the real 20-row run demonstrated the
// actual failure mode: this ceiling bounds *simulated* (fake-clock) time,
// but ordinary machine contention (e.g. another test suite running
// concurrently) only slows down how much real wall-clock time each
// poll iteration costs — it does not change how many ticks a run
// genuinely needs to finish. A generous multiplier here is cheap
// insurance against that, independent of the real wall-clock budget
// `corpus:generate`'s own --testTimeout provides.
const POLL_CEILING_MULTIPLIER = 10;

export type CorpusExportRow = CorpusRunRecord & {
	sweepIndex: number;
	separationWeight: number;
	foodRegenRate: number;
	crossbreedingEnabled: boolean;
	maxDurationSeconds: number;
	endedViaExtinction: boolean;
};

function runFileName(sweepIndex: number): string {
	return `run-${String(sweepIndex).padStart(2, "0")}.json`;
}

// `CorpusRunRecord.history` is `unknown` (schema-less JSON column, per
// harness.ts's own comment) — both fields read here are written by every
// server-owned run's `finishRun` (server-run-registry.ts), so they're
// present for every run this orchestrator itself starts and stops.
function readHistoryFields(history: unknown): {
	populationCountSamples: number[] | undefined;
	elapsedSeconds: number | undefined;
} {
	const parsed = history as
		| { populationCountSamples?: number[]; elapsedSeconds?: number }
		| null
		| undefined;
	return {
		populationCountSamples: parsed?.populationCountSamples,
		elapsedSeconds: parsed?.elapsedSeconds,
	};
}

function buildExportRow(
	record: CorpusRunRecord,
	row: SweepRunParams,
): CorpusExportRow {
	const { populationCountSamples } = readHistoryFields(record.history);
	const endedViaExtinction =
		populationCountSamples !== undefined && populationCountSamples.length > 0
			? populationCountSamples[populationCountSamples.length - 1] === 0
			: false;

	return {
		...record,
		sweepIndex: row.sweepIndex,
		separationWeight: row.separationWeight,
		foodRegenRate: row.foodRegenRate,
		crossbreedingEnabled: row.crossbreedingEnabled,
		maxDurationSeconds: row.maxDurationSeconds,
		endedViaExtinction,
	};
}

function buildCsvLine(exportRow: CorpusExportRow): string {
	const { elapsedSeconds } = readHistoryFields(exportRow.history);
	return [
		exportRow.sweepIndex,
		exportRow.separationWeight,
		exportRow.foodRegenRate,
		exportRow.crossbreedingEnabled,
		exportRow.score ?? "",
		exportRow.finalGeneticDiversity,
		elapsedSeconds ?? "",
		exportRow.endedViaExtinction,
		runFileName(exportRow.sweepIndex),
	].join(",");
}

// Advances the shared fake-timer clock in bounded, fixed-size steps,
// re-reading each run's status from the DB after every step, until every
// id in `runIds` has reached `status: "stopped"`. Throws once the ceiling
// (derived from the batch's own longest configured duration) is exceeded
// without that happening, rather than looping forever.
async function pollUntilAllStopped(
	db: DB,
	runIds: number[],
	longestMaxDurationSeconds: number,
): Promise<void> {
	const ceilingMs = longestMaxDurationSeconds * 1000 * POLL_CEILING_MULTIPLIER;
	let advancedMs = 0;

	while (advancedMs <= ceilingMs) {
		const rows = await db
			.select({ id: simulationRuns.id, status: simulationRuns.status })
			.from(simulationRuns)
			.where(inArray(simulationRuns.id, runIds));

		if (
			rows.length === runIds.length &&
			rows.every((row) => row.status === "stopped")
		) {
			return;
		}

		await vi.advanceTimersByTimeAsync(POLL_STEP_MS);
		advancedMs += POLL_STEP_MS;
	}

	throw new Error(
		`generateCorpus: runs [${runIds.join(", ")}] did not all reach "stopped" within the polling ceiling (${ceilingMs}ms of advanced fake time)`,
	);
}

async function runBatch(
	db: DB,
	batch: SweepRunParams[],
	outDir: string,
	csvRows: string[],
): Promise<void> {
	const batchParamsList = batch.map(({ sweepIndex, ...params }) => params);
	const originalRanges = await ensureAdminRangesAdmitForBatch(
		db,
		batchParamsList,
	);

	try {
		const started = await Promise.all(
			batch.map(async (row) => {
				const { sweepIndex, ...params } = row;
				const { runId, ownerId } = await startCorpusRun(db, params, {
					skipRangeWiden: true,
				});
				return { sweepIndex, row, runId, ownerId };
			}),
		);

		await pollUntilAllStopped(
			db,
			started.map((s) => s.runId),
			Math.max(...batch.map((row) => row.maxDurationSeconds)),
		);

		for (const { row, runId, ownerId } of started) {
			const record = await collectAndCleanupCorpusRun(db, ownerId, runId);
			const exportRow = buildExportRow(record, row);
			writeFileSync(
				join(outDir, runFileName(exportRow.sweepIndex)),
				JSON.stringify(exportRow, null, 2),
			);
			csvRows.push(buildCsvLine(exportRow));
		}
	} finally {
		// `ensureAdminRangesAdmitForBatch` only widens and returns the
		// pre-widen snapshot — it does not restore for the caller. Mirrors
		// the exact update-call shape `startCorpusRun`'s own `finally`
		// restore uses (harness.ts), written back whether the batch
		// succeeded or threw: this row is shared with real traffic.
		await db
			.update(adminSettings)
			.set({ parameterRanges: originalRanges })
			.where(eq(adminSettings.id, ADMIN_SETTINGS_ID));
	}
}

// Drives `matrix` (the full 20-row `buildSweepMatrix()` by default, or a
// smaller matrix for the smoke test) through the harness in batches of 4,
// writing one `run-<NN>.json` per completed run and one `index.csv` row
// per run into `outDir` (created recursively if missing).
export async function generateCorpus(
	db: DB,
	outDir: string,
	matrix: SweepRunParams[] = buildSweepMatrix(),
): Promise<void> {
	mkdirSync(outDir, { recursive: true });

	// Defensive: a prior partial run may have left stray fixture owners
	// behind (e.g. a crash mid-batch, before `collectAndCleanupCorpusRun`'s
	// own cleanup ran) — delete them before this run starts widening the
	// shared admin-settings row against them.
	await db.delete(users).where(like(users.email, "corpus-%@example.com"));

	const ownsFakeTimers = !vi.isFakeTimers();
	if (ownsFakeTimers) {
		vi.useFakeTimers();
	}

	const csvRows: string[] = [
		"sweepIndex,separationWeight,foodRegenRate,crossbreedingEnabled,score,finalGeneticDiversity,elapsedSeconds,endedViaExtinction,file",
	];

	try {
		for (let i = 0; i < matrix.length; i += BATCH_SIZE) {
			const batch = matrix.slice(i, i + BATCH_SIZE);
			await runBatch(db, batch, outDir, csvRows);
		}
	} finally {
		if (ownsFakeTimers) {
			vi.useRealTimers();
		}
	}

	writeFileSync(join(outDir, "index.csv"), `${csvRows.join("\n")}\n`);
}
