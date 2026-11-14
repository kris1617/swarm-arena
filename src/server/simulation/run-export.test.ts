import { describe, expect, it } from "vitest";
import {
	buildRunExport,
	type RunExportRow,
} from "~/server/simulation/run-export";

const SAMPLE_RUN: RunExportRow = {
	id: 42,
	status: "stopped",
	score: 0.75,
	startedAt: new Date("2026-01-01T00:00:00.000Z"),
	stoppedAt: new Date("2026-01-01T00:05:00.000Z"),
	boidCount: 10,
	separationWeight: 1,
	alignmentWeight: 1,
	cohesionWeight: 1,
	maxDurationSeconds: 60,
	predatorCount: 2,
	protectionThreshold: 3,
	foodStockInitial: 100,
	foodRegenRate: 1,
	flockCount: 2,
	crossbreedingEnabled: true,
	energyThreshold: 50,
	mutationChance: 0.1,
	mutationMagnitude: 0.2,
	history: {
		phaseHistory: ["establishment"],
		foodRatioSamples: [0.5],
		survivorGenes: [{ color: { r: 0, g: 0, b: 0 } }],
		populationCountSamples: [10],
	},
};

describe("buildRunExport", () => {
	it("serializes the full row, including history, in JSON mode", () => {
		const result = buildRunExport(SAMPLE_RUN, "json");

		expect(result.contentType).toBe("application/json");
		expect(result.filename).toBe("run-42.json");

		const parsed = JSON.parse(result.body) as Record<string, unknown>;
		expect(parsed).toMatchObject({
			id: 42,
			status: "stopped",
			score: 0.75,
			startedAt: "2026-01-01T00:00:00.000Z",
			stoppedAt: "2026-01-01T00:05:00.000Z",
			boidCount: 10,
			separationWeight: 1,
			alignmentWeight: 1,
			cohesionWeight: 1,
			maxDurationSeconds: 60,
			predatorCount: 2,
			protectionThreshold: 3,
			foodStockInitial: 100,
			foodRegenRate: 1,
			flockCount: 2,
			crossbreedingEnabled: true,
			energyThreshold: 50,
			mutationChance: 0.1,
			mutationMagnitude: 0.2,
			history: SAMPLE_RUN.history,
		});
	});

	it("excludes fields outside RunExportRow from JSON mode, even if present on the input object", () => {
		// The real Drizzle row the route handler passes in has more columns
		// than RunExportRow types (userId, seed, savedState) — the type
		// annotation alone doesn't strip them at runtime, so this guards
		// against a regression to spreading `run` directly.
		const rowWithExtraFields = {
			...SAMPLE_RUN,
			userId: "some-user-uuid",
			seed: 123456,
			savedState: { some: "live-state-snapshot" },
		};

		const result = buildRunExport(rowWithExtraFields, "json");
		const parsed = JSON.parse(result.body) as Record<string, unknown>;

		expect(parsed.userId).toBeUndefined();
		expect(parsed.seed).toBeUndefined();
		expect(parsed.savedState).toBeUndefined();
	});

	it("serializes a null stoppedAt as null in JSON mode", () => {
		const result = buildRunExport({ ...SAMPLE_RUN, stoppedAt: null }, "json");
		const parsed = JSON.parse(result.body) as Record<string, unknown>;
		expect(parsed.stoppedAt).toBeNull();
	});

	it("emits a two-line CSV with header + one data row, excluding history", () => {
		const result = buildRunExport(SAMPLE_RUN, "csv");

		expect(result.contentType).toBe("text/csv");
		expect(result.filename).toBe("run-42.csv");

		const lines = result.body.trim().split("\n");
		expect(lines).toHaveLength(2);

		expect(lines[0]).toBe(
			"id,status,score,startedAt,stoppedAt,boidCount,separationWeight,alignmentWeight,cohesionWeight,maxDurationSeconds,predatorCount,protectionThreshold,foodStockInitial,foodRegenRate,flockCount,crossbreedingEnabled,energyThreshold,mutationChance,mutationMagnitude",
		);
		expect(lines[1]).toBe(
			"42,stopped,0.75,2026-01-01T00:00:00.000Z,2026-01-01T00:05:00.000Z,10,1,1,1,60,2,3,100,1,2,true,50,0.1,0.2",
		);
		expect(result.body).not.toContain("history");
		expect(result.body).not.toContain("establishment");
	});

	it("serializes a null stoppedAt/score as the literal string null in CSV mode", () => {
		const result = buildRunExport(
			{ ...SAMPLE_RUN, score: null, stoppedAt: null },
			"csv",
		);
		const [, row] = result.body.trim().split("\n");
		const columns = row?.split(",") ?? [];
		expect(columns[2]).toBe("null"); // score
		expect(columns[4]).toBe("null"); // stoppedAt
	});
});
