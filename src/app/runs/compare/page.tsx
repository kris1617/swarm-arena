"use client";

import { useSearchParams } from "next/navigation";
import {
	Bar,
	BarChart,
	CartesianGrid,
	Legend,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";
import { AnalysisCard } from "~/components/analysis-card";
import { StatusMessage } from "~/components/ui/status-message";
import { api } from "~/trpc/react";

const FACTOR_LABELS = {
	survival: "Survival",
	resourceManagement: "Resource management",
	geneticDiversity: "Genetic diversity",
	phaseQuality: "Phase quality",
	areaPopulationDensity: "Area population density",
} as const;

// S-12: one color per run column/bar, cycled for up to 4 runs. Sourced from
// the --chart-1..5 tokens (globals.css) — same identities runs/[runId] uses
// for recovery/growth/overshoot/crash.
const RUN_COLORS = [
	"var(--chart-5)",
	"var(--chart-2)",
	"var(--chart-3)",
	"var(--chart-4)",
];

const ERROR_LABELS = {
	"not-found": "not found",
	forbidden: "not yours",
	"not-completed": "not completed",
} as const;

type ErroredRow = {
	runId: number;
	error: "not-found" | "forbidden" | "not-completed";
};

type OkRow = {
	runId: number;
	score: number | null;
	startedAt: Date;
	stoppedAt: Date | null;
	parameters: {
		boidCount: number;
		predatorCount: number;
		foodStockInitial: number;
		foodRegenRate: number;
		protectionThreshold: number;
	};
	breakdown: {
		survival: number;
		resourceManagement: number;
		geneticDiversity: number;
		phaseQuality: number;
		areaPopulationDensity: number | null;
		predatorTribeBalance: number | null;
	} | null;
	comparable: boolean;
	disclaimer: string | null;
	wasAutoStopped: boolean;
};

type ComparisonRow = ErroredRow | OkRow;

function isOkRow(row: ComparisonRow): row is OkRow {
	return !("error" in row);
}

function isErroredRow(row: ComparisonRow): row is ErroredRow {
	return "error" in row;
}

function parseRunIds(raw: string | null): number[] | null {
	if (!raw) {
		return null;
	}
	const ids = raw
		.split(",")
		.map((part) => Number(part.trim()))
		.filter((id) => Number.isInteger(id) && id > 0);
	if (ids.length < 2 || ids.length > 4) {
		return null;
	}
	return ids;
}

export default function RunsComparePage() {
	const searchParams = useSearchParams();
	const runIds = parseRunIds(searchParams.get("ids"));

	const comparisonQuery = api.simulation.getRunsComparison.useQuery(
		{ runIds: runIds ?? [] },
		{ enabled: runIds !== null },
	);

	if (runIds === null) {
		return <StatusMessage>Could not load this comparison.</StatusMessage>;
	}

	if (comparisonQuery.isPending) {
		return <StatusMessage>Loading…</StatusMessage>;
	}

	if (comparisonQuery.isError || !comparisonQuery.data) {
		return <StatusMessage>Could not load this comparison.</StatusMessage>;
	}

	const rows = comparisonQuery.data;
	const okRows = rows.filter(isOkRow);
	const erroredRows = rows.filter(isErroredRow);

	const chartData = (
		Object.keys(FACTOR_LABELS) as Array<keyof typeof FACTOR_LABELS>
	).map((factor) => {
		const point: Record<string, string | number> = {
			factor: FACTOR_LABELS[factor],
		};
		for (const row of okRows) {
			if (row.breakdown && row.breakdown[factor] !== null) {
				point[`Run #${row.runId}`] = row.breakdown[factor];
			}
		}
		return point;
	});

	return (
		<div className="from-primary to-background text-foreground flex min-h-screen flex-col items-center gap-8 bg-gradient-to-b p-8">
			<h1 className="text-3xl font-bold">Compare runs</h1>

			{erroredRows.map((row) => (
				<p className="text-foreground/70" key={row.runId}>
					Run #{row.runId}: could not be loaded ({ERROR_LABELS[row.error]})
				</p>
			))}

			{okRows
				.filter((row) => row.breakdown?.areaPopulationDensity === null)
				.map((row) => (
					<p className="text-foreground/70 text-sm" key={`legacy-${row.runId}`}>
						Run #{row.runId} was scored before the area-population-density
						factor existed — its score and this run&apos;s other runs may not be
						directly comparable.
					</p>
				))}

			{okRows
				.filter((row) => !row.comparable)
				.map((row) => (
					<p
						className="text-foreground/70 text-sm"
						key={`throttled-${row.runId}`}
					>
						{row.disclaimer}
					</p>
				))}

			{okRows
				.filter((row) => row.wasAutoStopped)
				.map((row) => (
					<p
						className="text-foreground/70 text-sm"
						key={`auto-stopped-${row.runId}`}
					>
						Run #{row.runId} was stopped automatically — server restarted before
						it finished on its own.
					</p>
				))}

			{okRows.length === 0 ? (
				<p>Could not load this comparison.</p>
			) : (
				<>
					<AnalysisCard title="Parameters">
						<div className="flex flex-col gap-2">
							{okRows.map((row) => (
								<div key={row.runId}>
									<span className="font-semibold">Run #{row.runId}: </span>
									<span>
										{row.parameters.boidCount} boids,{" "}
										{row.parameters.predatorCount} predators, food stock{" "}
										{row.parameters.foodStockInitial}, food regen{" "}
										{row.parameters.foodRegenRate}, protection threshold{" "}
										{row.parameters.protectionThreshold}
									</span>
								</div>
							))}
						</div>
					</AnalysisCard>

					<AnalysisCard title="Score & factors">
						<table className="w-full text-left">
							<thead>
								<tr>
									<th className="pr-4">&nbsp;</th>
									{okRows.map((row) => (
										<th className="pr-4" key={row.runId}>
											Run #{row.runId}
										</th>
									))}
								</tr>
							</thead>
							<tbody>
								<tr>
									<td className="pr-4 font-semibold">Score</td>
									{okRows.map((row) => (
										<td className="pr-4" key={row.runId}>
											{row.score === null ? "—" : row.score.toFixed(2)}
										</td>
									))}
								</tr>
								{(
									Object.keys(FACTOR_LABELS) as Array<
										keyof typeof FACTOR_LABELS
									>
								).map((factor) => (
									<tr key={factor}>
										<td className="pr-4 font-semibold">
											{FACTOR_LABELS[factor]}
										</td>
										{okRows.map((row) => (
											<td className="pr-4" key={row.runId}>
												{row.breakdown
													? row.breakdown[factor] === null
														? "N/A"
														: row.breakdown[factor].toFixed(2)
													: "—"}
											</td>
										))}
									</tr>
								))}
							</tbody>
						</table>
					</AnalysisCard>

					<AnalysisCard title="Factor breakdown">
						<ResponsiveContainer height={300} width="100%">
							<BarChart data={chartData}>
								<CartesianGrid strokeDasharray="3 3" />
								<XAxis dataKey="factor" />
								<YAxis />
								<Tooltip />
								<Legend />
								{okRows.map((row, index) => (
									<Bar
										dataKey={`Run #${row.runId}`}
										fill={RUN_COLORS[index % RUN_COLORS.length]}
										key={row.runId}
									/>
								))}
							</BarChart>
						</ResponsiveContainer>
					</AnalysisCard>
				</>
			)}
		</div>
	);
}
