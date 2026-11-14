"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import { api } from "~/trpc/react";

type StatusFilter = "all" | "running" | "saved" | "completed";

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
	{ value: "all", label: "All" },
	{ value: "running", label: "Running" },
	{ value: "saved", label: "Saved" },
	{ value: "completed", label: "Completed" },
];

function formatDate(value: Date | string): string {
	return new Date(value).toLocaleString();
}

export default function DashboardPage() {
	const [filter, setFilter] = useState<StatusFilter>("all");

	// S-10 (MS-07): same polling cadence as /simulation's own run lists.
	const runningQuery = api.simulation.listRunning.useQuery(undefined, {
		refetchInterval: 2000,
	});
	const savedQuery = api.simulation.listSaved.useQuery(undefined, {
		refetchInterval: 2000,
	});
	const completedQuery = api.simulation.listCompleted.useQuery(undefined, {
		refetchInterval: 2000,
	});

	const isEmpty =
		(runningQuery.data?.length ?? 0) === 0 &&
		(savedQuery.data?.length ?? 0) === 0 &&
		(completedQuery.data?.length ?? 0) === 0;

	const showRunning = filter === "all" || filter === "running";
	const showSaved = filter === "all" || filter === "saved";
	const showCompleted = filter === "all" || filter === "completed";

	return (
		<main className="from-primary to-background text-foreground flex min-h-screen flex-col items-center gap-8 bg-gradient-to-b p-8">
			<h1 className="text-3xl font-bold">Your Simulations</h1>

			<div className="flex flex-wrap justify-center gap-2">
				{STATUS_FILTERS.map((f) => (
					<Button
						className={
							f.value === filter
								? "bg-foreground/35 text-foreground h-auto rounded-full px-6 py-2 font-semibold"
								: "bg-input text-foreground hover:bg-foreground/15 h-auto rounded-full px-6 py-2 font-semibold"
						}
						key={f.value}
						onClick={() => setFilter(f.value)}
						type="button"
					>
						{f.label}
					</Button>
				))}
			</div>

			{isEmpty ? (
				<div className="bg-input text-foreground flex w-full max-w-md flex-col items-center gap-3 rounded-2xl px-6 py-8 text-center">
					<p>You haven&apos;t started any simulations yet.</p>
					<Link
						className="bg-background text-foreground hover:bg-foreground/15 rounded-full px-6 py-2 font-semibold"
						href="/simulation"
					>
						Start a simulation
					</Link>
				</div>
			) : (
				<div className="flex w-full max-w-2xl flex-col gap-6">
					{showRunning && runningQuery.data && runningQuery.data.length > 0 ? (
						<section className="bg-input text-foreground flex flex-col gap-2 rounded-2xl px-4 py-3">
							<h2 className="font-semibold">Running</h2>
							{runningQuery.data.map((run) => (
								<div
									className="bg-background flex items-center justify-between gap-2 rounded-full px-4 py-2"
									key={run.id}
								>
									<span>
										Run #{run.id} — {run.boidCount} boids, {run.predatorCount}{" "}
										predators — started {formatDate(run.startedAt)}
									</span>
									<Link
										className="hover:bg-foreground/15 rounded-full px-4 py-1 font-semibold"
										href="/simulation"
									>
										View
									</Link>
								</div>
							))}
						</section>
					) : null}

					{showSaved && savedQuery.data && savedQuery.data.length > 0 ? (
						<section className="bg-input text-foreground flex flex-col gap-2 rounded-2xl px-4 py-3">
							<h2 className="font-semibold">Saved</h2>
							{savedQuery.data.map((run) => (
								<div
									className="bg-background flex items-center justify-between gap-2 rounded-full px-4 py-2"
									key={run.id}
								>
									<span>
										Run #{run.id} — {run.boidCount} boids, {run.predatorCount}{" "}
										predators — started {formatDate(run.startedAt)}
									</span>
									<Link
										className="hover:bg-foreground/15 rounded-full px-4 py-1 font-semibold"
										href="/simulation"
									>
										View
									</Link>
								</div>
							))}
						</section>
					) : null}

					{showCompleted &&
					completedQuery.data &&
					completedQuery.data.length > 0 ? (
						<section className="bg-input text-foreground flex flex-col gap-2 rounded-2xl px-4 py-3">
							<h2 className="font-semibold">Completed</h2>
							{completedQuery.data.map((run) => (
								<div
									className="bg-background flex items-center justify-between gap-2 rounded-full px-4 py-2"
									key={run.id}
								>
									<span>
										Run #{run.id} — {run.boidCount} boids, {run.predatorCount}{" "}
										predators — started {formatDate(run.startedAt)}
									</span>
									{/* plan-review F1: score is nullable — a run that failed
									to start lands here with no score. */}
									<span className="font-semibold">
										{run.score === null
											? "—"
											: `Score: ${run.score.toFixed(2)}`}
									</span>
								</div>
							))}
						</section>
					) : null}
				</div>
			)}

			<Link
				className="bg-input text-foreground hover:bg-foreground/35 rounded-full px-10 py-3 font-semibold"
				href="/simulation"
			>
				Start a new simulation
			</Link>
		</main>
	);
}
