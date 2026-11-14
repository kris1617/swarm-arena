// run-export Phase 1: a plain, framework-free formatter so it's
// unit-testable without a `NextRequest`/session — see
// `src/app/api/runs/[runId]/export/route.ts` for the Route Handler that
// gates access and delegates to this function.

export type RunExportRow = {
	id: number;
	status: string;
	score: number | null;
	startedAt: Date;
	stoppedAt: Date | null;
	boidCount: number;
	separationWeight: number;
	alignmentWeight: number;
	cohesionWeight: number;
	maxDurationSeconds: number;
	predatorCount: number;
	protectionThreshold: number;
	foodStockInitial: number;
	foodRegenRate: number;
	flockCount: number;
	crossbreedingEnabled: boolean;
	energyThreshold: number;
	mutationChance: number;
	mutationMagnitude: number;
	history: unknown; // schema-less JSON column, passed through as-is for JSON mode
};

// CSV column order — the 13 configured parameters plus score/startedAt/
// stoppedAt, excluding `history`'s nested arrays per the resolved product
// decision (PRD FR-017).
const CSV_COLUMNS = [
	"id",
	"status",
	"score",
	"startedAt",
	"stoppedAt",
	"boidCount",
	"separationWeight",
	"alignmentWeight",
	"cohesionWeight",
	"maxDurationSeconds",
	"predatorCount",
	"protectionThreshold",
	"foodStockInitial",
	"foodRegenRate",
	"flockCount",
	"crossbreedingEnabled",
	"energyThreshold",
	"mutationChance",
	"mutationMagnitude",
] as const satisfies readonly (keyof RunExportRow)[];

function csvValue(value: RunExportRow[(typeof CSV_COLUMNS)[number]]): string {
	if (value instanceof Date) {
		return value.toISOString();
	}
	return String(value);
}

export function buildRunExport(
	run: RunExportRow,
	format: "json" | "csv",
): { body: string; contentType: string; filename: string } {
	if (format === "csv") {
		const header = CSV_COLUMNS.join(",");
		const row = CSV_COLUMNS.map((column) => csvValue(run[column])).join(",");
		return {
			body: `${header}\n${row}\n`,
			contentType: "text/csv",
			filename: `run-${run.id}.csv`,
		};
	}

	const jsonBody = {
		...run,
		startedAt: run.startedAt.toISOString(),
		stoppedAt: run.stoppedAt ? run.stoppedAt.toISOString() : null,
	};

	return {
		body: JSON.stringify(jsonBody, null, 2),
		contentType: "application/json",
		filename: `run-${run.id}.json`,
	};
}
