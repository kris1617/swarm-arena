// suggestion-quality-corpus-test Phase 1: the one place both this change's
// Phase 2 and the future S-35 change read the committed 20-run
// parameter-sweep corpus from. Reads and decompresses each committed
// `run-<NN>.json.gz`, then reconstructs each run's full 16-field params by
// re-calling `buildSweepMatrix()` (the swept fields `generate-sweep.ts`'s
// export only carries 5 of) and merging in that run's real persisted
// score/history/completedCycles/finalGeneticDiversity/endedViaExtinction.
//
// Deliberately a `import type` for `StartCorpusRunParams` — a value import
// from harness.ts would pull vitest's `vi` and the DB/drizzle client into
// this otherwise DB-free, synchronous module. The only runtime import this
// file needs is `buildSweepMatrix` from `sweep-matrix.ts`, which itself
// only imports `~/server/simulation/parameter-ranges` (no DB/drizzle/vitest).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

import type { StartCorpusRunParams } from "../../../scripts/corpus/harness";
import { buildSweepMatrix } from "../../../scripts/corpus/sweep-matrix";

export type CorpusFixtureRow = {
	sweepIndex: number;
	params: StartCorpusRunParams;
	score: number;
	history: unknown;
	completedCycles: unknown;
	finalGeneticDiversity: number;
	endedViaExtinction: boolean;
};

const FIXTURE_DIR = "context/fixtures/parameter-sweep-corpus";

// Matches `generate-sweep.ts`'s own `runFileName` exactly (NN =
// `sweepIndex` zero-padded to 2 digits).
function runFileName(sweepIndex: number): string {
	return `run-${String(sweepIndex).padStart(2, "0")}.json.gz`;
}

// Shape of the decompressed per-run JSON this loader actually reads —
// mirrors `CorpusExportRow` (generate-sweep.ts) but only the fields this
// loader merges into a `CorpusFixtureRow`.
type PersistedCorpusRecord = {
	score: number | null;
	history: unknown;
	completedCycles: unknown;
	finalGeneticDiversity: number;
	endedViaExtinction: boolean;
};

function readPersistedRecord(sweepIndex: number): PersistedCorpusRecord {
	const filePath = join(process.cwd(), FIXTURE_DIR, runFileName(sweepIndex));
	let compressed: Buffer;
	try {
		compressed = readFileSync(filePath);
	} catch (error) {
		throw new Error(
			`loadCorpusFixture: no fixture file for sweepIndex ${sweepIndex} at ${filePath}`,
			{ cause: error },
		);
	}
	const json = gunzipSync(compressed).toString("utf8");
	return JSON.parse(json) as PersistedCorpusRecord;
}

// vitest-parallel-flakiness Phase 4: the committed fixture files never
// change during a test run, but this function is called from ≥9 places
// across the suite — caching the computed result avoids a fresh
// synchronous disk-read + gunzipSync of all 20 fixture files on every call,
// cutting CPU/IO contention under Vitest's parallel-worker file execution.
let cache: CorpusFixtureRow[] | undefined;

// Loads the real, persisted 20-run parameter-sweep corpus into memory as
// plain objects, each carrying its full reconstructed params (all 16
// `RangedParameterName` fields) alongside its real persisted
// score/history/completedCycles/finalGeneticDiversity/endedViaExtinction.
// Throws if a run's `sweepIndex` from the matrix has no matching file, or
// if any run's persisted `score` is `null` — a shrunk/moved corpus or an
// uncollected run should break loudly, not silently return a short array
// or a null score.
export function loadCorpusFixture(): CorpusFixtureRow[] {
	if (cache !== undefined) {
		return cache;
	}

	cache = buildSweepMatrix().map((row) => {
		const { sweepIndex, ...params } = row;
		const record = readPersistedRecord(sweepIndex);

		if (record.score === null) {
			throw new Error(
				`loadCorpusFixture: run ${runFileName(sweepIndex)} (sweepIndex ${sweepIndex}) has a null persisted score`,
			);
		}

		return {
			sweepIndex,
			params,
			score: record.score,
			history: record.history,
			completedCycles: record.completedCycles,
			finalGeneticDiversity: record.finalGeneticDiversity,
			endedViaExtinction: record.endedViaExtinction,
		};
	});

	return cache;
}
