"use client";

import Link from "next/link";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import { api } from "~/trpc/react";

function formatDate(value: Date | string): string {
	return new Date(value).toLocaleString();
}

export default function LeaderboardPage() {
	const leaderboardQuery = api.simulation.listLeaderboard.useQuery();

	const isLoading = leaderboardQuery.isPending;
	const isError = leaderboardQuery.isError;
	const isEmpty = (leaderboardQuery.data?.length ?? 0) === 0;

	return (
		<div className="from-primary to-background text-foreground flex min-h-screen flex-col items-center gap-8 bg-gradient-to-b p-8">
			<h1 className="text-3xl font-bold">Leaderboard</h1>

			{isLoading ? (
				<div className="flex w-full max-w-2xl flex-col gap-6">
					<Skeleton className="h-24 w-full rounded-2xl" />
					<Skeleton className="h-24 w-full rounded-2xl" />
				</div>
			) : isError ? (
				<div className="bg-input text-foreground flex w-full max-w-md flex-col items-center gap-3 rounded-2xl px-6 py-8 text-center">
					<p>Couldn&apos;t load the leaderboard. Try reloading the page.</p>
				</div>
			) : isEmpty ? (
				<div className="bg-input text-foreground flex w-full max-w-md flex-col items-center gap-3 rounded-2xl px-6 py-8 text-center">
					<p>No completed runs with a score yet.</p>
					<Button
						asChild
						className="bg-background text-foreground hover:bg-foreground/15 h-auto rounded-full px-6 py-2 font-semibold"
					>
						<Link href="/simulation">Start a simulation</Link>
					</Button>
				</div>
			) : (
				<div className="flex w-full max-w-2xl flex-col gap-6">
					<section className="bg-input text-foreground flex flex-col gap-2 rounded-2xl px-4 py-3">
						{leaderboardQuery.data?.map((run, index) => {
							const rank = index + 1;
							const isTopThree = rank <= 3;
							return (
								<div
									className={
										isTopThree
											? "bg-background border-primary flex items-center justify-between gap-2 rounded-full border-2 px-4 py-2"
											: "bg-background flex items-center justify-between gap-2 rounded-full px-4 py-2"
									}
									key={run.id}
								>
									<span className="font-semibold">#{rank}</span>
									<span>
										Run #{run.id} — {run.boidCount} boids, {run.predatorCount}{" "}
										predators — started {formatDate(run.startedAt)}
									</span>
									<span className="font-semibold">
										Score: {run.score?.toFixed(2)}
									</span>
									<Button
										asChild
										className="hover:bg-foreground/15 h-auto rounded-full px-4 py-1 font-semibold"
									>
										<Link href={`/runs/${run.id}`}>View analysis</Link>
									</Button>
								</div>
							);
						})}
					</section>
				</div>
			)}
		</div>
	);
}
