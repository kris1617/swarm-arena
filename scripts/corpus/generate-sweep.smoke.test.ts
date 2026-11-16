import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

import { like } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";

import { db } from "~/server/db";
import { resetAdminSettingsToDefaults } from "~/server/db/admin-settings-test-reset";
import { users } from "~/server/db/schema";
import { generateCorpus } from "./generate-sweep";
import { buildSweepMatrix, type SweepRunParams } from "./sweep-matrix";

// A reduced, fast-running stand-in for the full 20-row matrix — this smoke
// test proves `generateCorpus`'s batching/polling/export wiring works, not
// that the full sweep's real parameter space is covered (that's Phase 4's
// job, against the full `buildSweepMatrix()` output).
function buildSmokeMatrix(): SweepRunParams[] {
	return buildSweepMatrix()
		.slice(0, 2)
		.map((row) => ({ ...row, maxDurationSeconds: 2 }));
}

afterEach(async () => {
	vi.useRealTimers();
	// Same reset discipline harness.test.ts's own afterEach uses — a run
	// that widened admin ranges can't leak state into a later test. Upserts
	// back to defaults instead of deleting so a concurrently-running test
	// file never observes the row as briefly absent (see
	// admin-settings-test-reset.ts).
	await resetAdminSettingsToDefaults(db);
	// Defensive — the orchestrator's own `collectAndCleanupCorpusRun`
	// already deletes each fixture owner, but a test that threw mid-run
	// could leave one behind otherwise.
	await db.delete(users).where(like(users.email, "corpus-%@example.com"));
});

describe("generateCorpus smoke test", () => {
	it("writes per-run JSON files and an index.csv, and leaves no fixture owners behind", async () => {
		const outDir = mkdtempSync(join(tmpdir(), "corpus-smoke-"));
		try {
			const baselineIds = new Set(
				(
					await db.query.users.findMany({
						where: (t, { like }) => like(t.email, "corpus-%@example.com"),
					})
				).map((u) => u.id),
			);
			const matrix = buildSmokeMatrix();

			await generateCorpus(db, outDir, matrix);

			const files = readdirSync(outDir).sort();
			expect(files).toEqual(["index.csv", "run-01.json.gz", "run-02.json.gz"]);

			const run1 = JSON.parse(
				gunzipSync(readFileSync(join(outDir, "run-01.json.gz"))).toString(
					"utf-8",
				),
			);
			const run2 = JSON.parse(
				gunzipSync(readFileSync(join(outDir, "run-02.json.gz"))).toString(
					"utf-8",
				),
			);

			for (const [run, row] of [
				[run1, matrix[0]],
				[run2, matrix[1]],
			] as const) {
				expect(row).toBeDefined();
				expect(run.sweepIndex).toBe(row?.sweepIndex);
				expect(run.separationWeight).toBe(row?.separationWeight);
				expect(run.foodRegenRate).toBe(row?.foodRegenRate);
				expect(run.crossbreedingEnabled).toBe(row?.crossbreedingEnabled);
				expect(run.maxDurationSeconds).toBe(2);
				expect(run.score).not.toBeNull();
				expect(typeof run.finalGeneticDiversity).toBe("number");
				expect(typeof run.endedViaExtinction).toBe("boolean");
				expect(run.history).toMatchObject({
					phaseHistory: expect.any(Array),
					foodRatioSamples: expect.any(Array),
					survivorGenes: expect.any(Array),
				});
			}

			const csv = readFileSync(join(outDir, "index.csv"), "utf-8");
			const lines = csv.trim().split("\n");
			expect(lines).toHaveLength(3);
			expect(lines[0]).toBe(
				"sweepIndex,separationWeight,foodRegenRate,crossbreedingEnabled,score,finalGeneticDiversity,elapsedSeconds,endedViaExtinction,file",
			);
			expect(lines[1]).toContain(`run-01.json.gz`);
			expect(lines[2]).toContain(`run-02.json.gz`);
			expect(lines[1]?.startsWith(`${matrix[0]?.sweepIndex},`)).toBe(true);
			expect(lines[2]?.startsWith(`${matrix[1]?.sweepIndex},`)).toBe(true);

			const afterOwners = await db.query.users.findMany({
				where: (t, { like }) => like(t.email, "corpus-%@example.com"),
			});
			const newStrayOwners = afterOwners.filter((u) => !baselineIds.has(u.id));
			expect(newStrayOwners).toHaveLength(0);
		} finally {
			rmSync(outDir, { recursive: true, force: true });
		}
	});
});
