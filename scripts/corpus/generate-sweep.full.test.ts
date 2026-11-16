// parameter-sweep-corpus-generation Phase 4: the real, one-time entry point
// a maintainer runs via `npm run corpus:generate` to build the full 20-row
// parameter-sweep corpus into `context/fixtures/parameter-sweep-corpus`.
// Excluded from the default `vitest.config.ts` suite (see its `exclude`
// array) — run only via `vitest.corpus.config.ts`. Deliberately long-running
// (up to 60 minutes, see package.json's `--testTimeout`): 5 batches of 4
// runs, each run ticking up to `maxDurationSeconds: 3600` under fake timers.
// The per-test timeout below must match package.json's `corpus:generate`
// --testTimeout (a hardcoded it() timeout always wins over the CLI flag,
// regardless of what the flag says) — this mismatch is exactly what made
// the real run time out at 20 minutes despite a 60-minute CLI flag.
// Do not shrink the matrix or the per-run duration here — that would defeat
// this test's purpose as the real generation run.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { like } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";

import { db } from "~/server/db";
import { adminSettings, users } from "~/server/db/schema";
import type { PopulationPhase } from "~/server/simulation/boids";
import { generateCorpus } from "./generate-sweep";
import { buildSweepMatrix } from "./sweep-matrix";

const OUT_DIR = "context/fixtures/parameter-sweep-corpus";

const ALL_PHASES: PopulationPhase[] = [
	"establishment",
	"growth",
	"overshoot",
	"crash",
	"recovery",
];

afterEach(async () => {
	vi.useRealTimers();
	// Same reset discipline the smoke test's own afterEach uses — a run that
	// widened admin ranges can't leak state into a later test.
	await db.delete(adminSettings);
	// Defensive — the orchestrator's own `collectAndCleanupCorpusRun` already
	// deletes each fixture owner, but a test that threw mid-run could leave
	// one behind otherwise.
	await db.delete(users).where(like(users.email, "corpus-%@example.com"));
});

describe("generateCorpus full-matrix generation", () => {
	it(
		"writes the full 20-run corpus and index.csv, covering every population phase, with no fixture owners left behind",
		async () => {
			const matrix = buildSweepMatrix();
			expect(matrix).toHaveLength(20);

			await generateCorpus(db, OUT_DIR, matrix);

			const files = readdirSync(OUT_DIR).sort();
			const expectedRunFiles = matrix.map(
				(row) => `run-${String(row.sweepIndex).padStart(2, "0")}.json`,
			);
			expect(files).toEqual(["index.csv", ...expectedRunFiles].sort());

			const seenPhases = new Set<PopulationPhase>();

			for (const row of matrix) {
				const fileName = `run-${String(row.sweepIndex).padStart(2, "0")}.json`;
				const record = JSON.parse(
					readFileSync(join(OUT_DIR, fileName), "utf-8"),
				);

				expect(record.sweepIndex).toBe(row.sweepIndex);
				expect(record.separationWeight).toBe(row.separationWeight);
				expect(record.foodRegenRate).toBe(row.foodRegenRate);
				expect(record.crossbreedingEnabled).toBe(row.crossbreedingEnabled);
				expect(record.maxDurationSeconds).toBe(3600);
				expect(typeof record.endedViaExtinction).toBe("boolean");
				expect(record.score === null || typeof record.score === "number").toBe(
					true,
				);
				expect(typeof record.finalGeneticDiversity).toBe("number");
				expect(record.params).toBeDefined();
				expect(record.history).toMatchObject({
					phaseHistory: expect.any(Array),
					foodRatioSamples: expect.any(Array),
					survivorGenes: expect.any(Array),
				});

				for (const phase of record.history.phaseHistory as PopulationPhase[]) {
					seenPhases.add(phase);
				}
			}

			for (const phase of ALL_PHASES) {
				expect(seenPhases.has(phase)).toBe(true);
			}

			const csv = readFileSync(join(OUT_DIR, "index.csv"), "utf-8");
			const lines = csv.trim().split("\n");
			expect(lines).toHaveLength(21);
			expect(lines[0]).toBe(
				"sweepIndex,separationWeight,foodRegenRate,crossbreedingEnabled,score,finalGeneticDiversity,elapsedSeconds,endedViaExtinction,file",
			);

			const dataLines = lines.slice(1);
			expect(dataLines).toHaveLength(20);
			for (const row of matrix) {
				const fileName = `run-${String(row.sweepIndex).padStart(2, "0")}.json`;
				expect(
					dataLines.some(
						(line) =>
							line.startsWith(`${row.sweepIndex},`) && line.includes(fileName),
					),
				).toBe(true);
			}

			const strayOwners = await db.query.users.findMany({
				where: (t, { like: likeFn }) => likeFn(t.email, "corpus-%@example.com"),
			});
			expect(strayOwners).toHaveLength(0);
		},
		60 * 60 * 1000,
	);
});
