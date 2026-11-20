"use client";

import Link from "next/link";
import { useState } from "react";
import { RunRow } from "~/components/run-row";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Skeleton } from "~/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "~/components/ui/tabs";
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

const statusCardClassName =
	"bg-input text-foreground flex w-full max-w-md flex-col items-center gap-3 rounded-2xl px-6 py-8 text-center";

export default function DashboardPage() {
	const [filter, setFilter] = useState<StatusFilter>("all");
	// S-12: pending selection for "compare completed runs" — scoped to the
	// Completed section only, never touched by Running/Saved.
	const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

	function toggleSelected(runId: number) {
		setSelectedIds((prev) => {
			const next = new Set(prev);
			if (next.has(runId)) {
				next.delete(runId);
			} else {
				next.add(runId);
			}
			return next;
		});
	}

	const canCompare = selectedIds.size >= 2 && selectedIds.size <= 4;

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

	const isLoading =
		runningQuery.isPending || savedQuery.isPending || completedQuery.isPending;

	const isError =
		runningQuery.isError || savedQuery.isError || completedQuery.isError;

	const isEmpty =
		(runningQuery.data?.length ?? 0) === 0 &&
		(savedQuery.data?.length ?? 0) === 0 &&
		(completedQuery.data?.length ?? 0) === 0;

	const showRunning = filter === "all" || filter === "running";
	const showSaved = filter === "all" || filter === "saved";
	const showCompleted = filter === "all" || filter === "completed";

	return (
		<div className="from-primary to-background text-foreground flex min-h-screen flex-col items-center gap-8 bg-gradient-to-b p-8">
			<h1 className="text-3xl font-bold">Your Simulations</h1>

			<Tabs onValueChange={(v) => setFilter(v as StatusFilter)} value={filter}>
				<TabsList>
					{STATUS_FILTERS.map((f) => (
						<TabsTrigger key={f.value} value={f.value}>
							{f.label}
						</TabsTrigger>
					))}
				</TabsList>
			</Tabs>

			{isLoading ? (
				<div className="flex w-full max-w-2xl flex-col gap-6">
					<Skeleton className="h-24 w-full rounded-2xl" />
					<Skeleton className="h-24 w-full rounded-2xl" />
				</div>
			) : isError ? (
				<div className={statusCardClassName}>
					<p>Couldn&apos;t load your simulations. Try reloading the page.</p>
				</div>
			) : isEmpty ? (
				<div className={statusCardClassName}>
					<p>You haven&apos;t started any simulations yet.</p>
					<Button
						asChild
						className="bg-background text-foreground hover:bg-foreground/15 h-auto rounded-full px-6 py-2 font-semibold"
					>
						<Link href="/simulation">Start a simulation</Link>
					</Button>
				</div>
			) : (
				<div className="flex w-full max-w-2xl flex-col gap-6">
					{showRunning && runningQuery.data && runningQuery.data.length > 0 ? (
						<section className="bg-input text-foreground flex flex-col gap-2 rounded-2xl px-4 py-3">
							<h2 className="font-semibold">Running</h2>
							{runningQuery.data.map((run) => (
								<RunRow
									actionHref="/simulation"
									actionLabel="View"
									key={run.id}
									label={
										<span>
											Run #{run.id} — {run.boidCount} boids, {run.predatorCount}{" "}
											predators — started {formatDate(run.startedAt)}
										</span>
									}
								/>
							))}
						</section>
					) : null}

					{showSaved && savedQuery.data && savedQuery.data.length > 0 ? (
						<section className="bg-input text-foreground flex flex-col gap-2 rounded-2xl px-4 py-3">
							<h2 className="font-semibold">Saved</h2>
							{savedQuery.data.map((run) => (
								<RunRow
									actionHref="/simulation"
									actionLabel="View"
									key={run.id}
									label={
										<span>
											Run #{run.id} — {run.boidCount} boids, {run.predatorCount}{" "}
											predators — started {formatDate(run.startedAt)}
										</span>
									}
								/>
							))}
						</section>
					) : null}

					{showCompleted &&
					completedQuery.data &&
					completedQuery.data.length > 0 ? (
						<section className="bg-input text-foreground flex flex-col gap-2 rounded-2xl px-4 py-3">
							<h2 className="font-semibold">Completed</h2>
							{completedQuery.data.map((run) => {
								const isSelected = selectedIds.has(run.id);
								const selectionDisabled = !isSelected && selectedIds.size >= 4;
								return (
									<RunRow
										actionHref={`/runs/${run.id}`}
										actionLabel="View analysis"
										key={run.id}
										label={
											<span>
												Run #{run.id} — {run.boidCount} boids,{" "}
												{run.predatorCount} predators — started{" "}
												{formatDate(run.startedAt)}
											</span>
										}
										leading={
											<Checkbox
												aria-label={`Select run #${run.id} for comparison`}
												checked={isSelected}
												disabled={selectionDisabled}
												onCheckedChange={() => toggleSelected(run.id)}
											/>
										}
										trailing={
											<>
												{/* plan-review F1: score is nullable — a run that
												failed to start lands here with no score. */}
												<span className="font-semibold">
													{run.score === null
														? "—"
														: `Score: ${run.score.toFixed(2)}`}
												</span>
												{/* fix-default-start-failure Phase 3: distinguishes
												a null-score row the reconciliation sweep stopped
												from an unexplained one. */}
												{run.wasAutoStopped ? (
													<span className="text-foreground/70 text-sm">
														Stopped automatically — server restarted
													</span>
												) : null}
											</>
										}
									/>
								);
							})}
							{/* S-12: enabled only for 2–4 selected completed runs. */}
							{canCompare ? (
								<Button
									asChild
									className="bg-foreground/35 text-foreground h-auto self-start rounded-full px-6 py-2 font-semibold"
								>
									<Link
										href={`/runs/compare?ids=${[...selectedIds].join(",")}`}
									>
										Compare selected
									</Link>
								</Button>
							) : (
								<Button
									className="h-auto self-start rounded-full px-6 py-2 font-semibold"
									disabled
									type="button"
								>
									Compare selected
								</Button>
							)}
						</section>
					) : null}
				</div>
			)}

			<Button
				asChild
				className="bg-input text-foreground hover:bg-foreground/35 h-auto rounded-full px-10 py-3 font-semibold"
			>
				<Link href="/simulation">Start a new simulation</Link>
			</Button>
		</div>
	);
}
