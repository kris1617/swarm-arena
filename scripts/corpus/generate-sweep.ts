// parameter-sweep-corpus-generation Phase 3: batches `buildSweepMatrix()`'s
// ~20-row parameter matrix through the (batch-safe) harness built in Phase
// 1/2, 4 runs at a time, and exports each completed run to a JSON file plus
// one CSV index row. See this phase's plan for the batching/polling
// rationale; the real 20-row corpus this writes into
// `context/fixtures/parameter-sweep-corpus/` is Phase 4's job — this module
// is Phase 4's (and this phase's own smoke test's) entry point.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

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
// Widened from an initial 3x, then 10x, after real 20-row runs demonstrated
// the actual failure mode: this ceiling bounds *simulated* (fake-clock)
// time, but ordinary machine contention (e.g. another test suite running
// concurrently) and a dense-clustering batch's genuinely-higher per-tick
// cost (see spatial-grid-dense-clustering-fallback) both only affect how
// much real wall-clock time each poll iteration costs — neither changes
// how much simulated time a run genuinely needs to finish. Widened again
// to 50x so this ceiling is never the binding constraint in practice;
// `corpus:generate`'s own --testTimeout is the real, intentional wall-clock
// budget now.
const POLL_CEILING_MULTIPLIER = 50;

export type CorpusExportRow = CorpusRunRecord & {
	sweepIndex: number;
	separationWeight: number;
	foodRegenRate: number;
	crossbreedingEnabled: boolean;
	maxDurationSeconds: number;
	endedViaExtinction: boolean;
};

// impl-review finding (parameter-sweep-corpus-generation): the real 20-row
// corpus's per-run JSON is highly repetitive (phaseHistory strings, boid
// gene arrays) and compresses ~300x with gzip — 289MB of raw JSON becomes
// ~916KB. Writing `.gz` directly here (rather than relying on a manual
// post-processing step, as the first real run originally did) keeps a
// future `npm run corpus:generate` re-run reproducing exactly what's
// committed, instead of silently drifting back to uncompressed output.
function runFileName(sweepIndex: number): string {
	return `run-${String(sweepIndex).padStart(2, "0")}.json.gz`;
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

	// impl-review finding (parameter-sweep-corpus-generation): if any call in
	// the `Promise.all` below rejects, or `pollUntilAllStopped` throws after
	// the ceiling, `started` runs that the harness DID insert are never
	// passed to `collectAndCleanupCorpusRun` by this invocation — their
	// fixture owner/run rows would otherwise leak until a *future*
	// `generateCorpus` call's defensive top-of-run cleanup happens to catch
	// them. `startedInBatch` is populated as each `startCorpusRun` resolves
	// (not after `Promise.all` settles) so the `catch` below can clean up
	// every run this batch actually started, even the ones whose later
	// polling/collection step never ran.
	const startedInBatch: { runId: number; ownerId: string }[] = [];
	const collectedOwnerIds = new Set<string>();

	try {
		const started = await Promise.all(
			batch.map(async (row) => {
				const { sweepIndex, ...params } = row;
				const { runId, ownerId } = await startCorpusRun(db, params, {
					skipRangeWiden: true,
				});
				startedInBatch.push({ runId, ownerId });
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
			collectedOwnerIds.add(ownerId);
			const exportRow = buildExportRow(record, row);
			writeFileSync(
				join(outDir, runFileName(exportRow.sweepIndex)),
				gzipSync(JSON.stringify(exportRow, null, 2)),
			);
			csvRows.push(buildCsvLine(exportRow));
		}
	} catch (error) {
		// Clean up every run this batch actually started but never reached
		// `collectAndCleanupCorpusRun` for (a rejected start, or a
		// `pollUntilAllStopped` ceiling throw, leaves these otherwise
		// orphaned until some *future* `generateCorpus` call's defensive
		// cleanup happens to catch them) — see this function's own comment
		// above `startedInBatch`.
		await Promise.all(
			startedInBatch
				.filter((s) => !collectedOwnerIds.has(s.ownerId))
				.map((s) => db.delete(users).where(eq(users.id, s.ownerId))),
		);
		throw error;
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
