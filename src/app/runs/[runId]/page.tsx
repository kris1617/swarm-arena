"use client";

import { useParams } from "next/navigation";
import {
	CartesianGrid,
	Line,
	LineChart,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";
import type { PopulationPhase } from "~/server/simulation/boids";
import { api } from "~/trpc/react";

// S-11 (MS-08): one color per phase, used for the population chart's
// per-point dot color and the phase-breakdown stat list.
const PHASE_COLORS: Record<PopulationPhase, string> = {
	establishment: "#9ca3af",
	growth: "#22c55e",
	overshoot: "#f59e0b",
	crash: "#ef4444",
	recovery: "#38bdf8",
};

const PHASE_LABELS: Record<PopulationPhase, string> = {
	establishment: "Establishment",
	growth: "Growth",
	overshoot: "Overshoot",
	crash: "Crash",
	recovery: "Recovery",
};

function PhaseDot(props: {
	cx?: number;
	cy?: number;
	payload?: { phase: PopulationPhase };
}) {
	const { cx, cy, payload } = props;
	if (cx === undefined || cy === undefined || !payload) {
		return null;
	}
	return <circle cx={cx} cy={cy} fill={PHASE_COLORS[payload.phase]} r={2} />;
}

export default function RunAnalysisPage() {
	const { runId } = useParams<{ runId: string }>();
	const analysisQuery = api.simulation.getRunAnalysis.useQuery({
		runId: Number(runId),
	});

	if (analysisQuery.isPending) {
		return (
			<main className="from-primary to-background text-foreground flex min-h-screen flex-col items-center justify-center bg-gradient-to-b p-8">
				<p>Loading…</p>
			</main>
		);
	}

	if (analysisQuery.isError || !analysisQuery.data) {
		return (
			<main className="from-primary to-background text-foreground flex min-h-screen flex-col items-center justify-center bg-gradient-to-b p-8">
				<p>Could not load this run&apos;s analysis.</p>
			</main>
		);
	}

	const { history, completedCycles, finalGeneticDiversity, score } =
		analysisQuery.data;

	const populationSamples = history?.populationCountSamples;
	const chartData = populationSamples?.map((population, tick) => ({
		tick,
		population,
		phase: history?.phaseHistory[tick] ?? "establishment",
	}));

	const phaseTally = history
		? history.phaseHistory.reduce<Record<PopulationPhase, number>>(
				(tally, phase) => {
					tally[phase] = (tally[phase] ?? 0) + 1;
					return tally;
				},
				{
					establishment: 0,
					growth: 0,
					overshoot: 0,
					crash: 0,
					recovery: 0,
				},
			)
		: null;
	const totalTicks = history?.phaseHistory.length ?? 0;

	return (
		<main className="from-primary to-background text-foreground flex min-h-screen flex-col items-center gap-8 bg-gradient-to-b p-8">
			<h1 className="text-3xl font-bold">
				Run #{runId} Analysis{" "}
				{score !== null ? `— Score: ${score.toFixed(2)}` : ""}
			</h1>

			<section className="bg-input text-foreground flex w-full max-w-2xl flex-col gap-2 rounded-2xl px-4 py-3">
				<h2 className="font-semibold">Population over time</h2>
				{chartData && chartData.length > 0 ? (
					<ResponsiveContainer height={240} width="100%">
						<LineChart data={chartData}>
							<CartesianGrid strokeDasharray="3 3" />
							<XAxis dataKey="tick" label="Tick" />
							<YAxis label="Population" />
							<Tooltip />
							<Line
								dataKey="population"
								// biome-ignore lint/suspicious/noExplicitAny: Recharts' dot prop type doesn't accept a typed custom-props function cleanly.
								dot={PhaseDot as any}
								stroke="#38bdf8"
								type="monotone"
							/>
						</LineChart>
					</ResponsiveContainer>
				) : (
					<p>No population data recorded for this run.</p>
				)}
			</section>

			<section className="bg-input text-foreground flex w-full max-w-2xl flex-col gap-2 rounded-2xl px-4 py-3">
				<h2 className="font-semibold">Time in each phase</h2>
				{phaseTally && totalTicks > 0 ? (
					<ul className="flex flex-col gap-1">
						{Object.entries(phaseTally).map(([phase, count]) => (
							<li className="flex items-center gap-2" key={phase}>
								<span
									className="inline-block h-3 w-3 rounded-full"
									style={{
										backgroundColor: PHASE_COLORS[phase as PopulationPhase],
									}}
								/>
								<span>
									{PHASE_LABELS[phase as PopulationPhase]}:{" "}
									{((count / totalTicks) * 100).toFixed(1)}%
								</span>
							</li>
						))}
					</ul>
				) : (
					<p>No phase data recorded for this run.</p>
				)}
			</section>

			<section className="bg-input text-foreground flex w-full max-w-2xl flex-col gap-2 rounded-2xl px-4 py-3">
				<h2 className="font-semibold">Completed resilience cycles</h2>
				{completedCycles.length > 0 ? (
					<ul className="flex flex-col gap-1">
						{completedCycles.map((cycle, index) => (
							<li key={`${cycle.startTick}-${cycle.endTick}`}>
								Cycle {index + 1}: ticks {cycle.startTick}–{cycle.endTick}
							</li>
						))}
					</ul>
				) : (
					<p>No completed crash→recovery cycles in this run.</p>
				)}
			</section>

			<section className="bg-input text-foreground flex w-full max-w-2xl flex-col gap-2 rounded-2xl px-4 py-3">
				<h2 className="font-semibold">Final genetic diversity</h2>
				<p>{finalGeneticDiversity.toFixed(3)}</p>
			</section>
		</main>
	);
}
