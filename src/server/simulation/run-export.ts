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
	// unwatched-run-tick-throttling Phase 3: sticky comparability marker,
	// carried through so an exported row discloses whether it was ever
	// ticked at the throttled speed multiplier while unwatched.
	wasEverThrottled: boolean;
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
	"wasEverThrottled",
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

	// impl-review (run-export): build an explicit allow-listed object here
	// too, same as the CSV branch's `CSV_COLUMNS` — spreading `run` directly
	// leaked fields outside `RunExportRow`'s named contract (`userId`,
	// `seed`, `savedState`) because the type annotation only restricts what
	// TypeScript checks at the call site, not what's actually on the object
	// the route handler passes in (the raw Drizzle row has every column).
	const jsonBody: Record<string, unknown> = {};
	for (const column of CSV_COLUMNS) {
		jsonBody[column] = run[column];
	}
	jsonBody.startedAt = run.startedAt.toISOString();
	jsonBody.stoppedAt = run.stoppedAt ? run.stoppedAt.toISOString() : null;
	jsonBody.history = run.history;

	return {
		body: JSON.stringify(jsonBody, null, 2),
		contentType: "application/json",
		filename: `run-${run.id}.json`,
	};
}
