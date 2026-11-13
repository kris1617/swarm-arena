"use client";

import { useEffect } from "react";

import { Button } from "~/components/ui/button";

export default function ErrorBoundary({
	error,
	reset,
}: {
	error: Error & { digest?: string };
	reset: () => void;
}) {
	useEffect(() => {
		console.error(error);
	}, [error]);

	return (
		<main className="from-primary to-background text-foreground flex min-h-screen flex-col items-center justify-center gap-8 bg-gradient-to-b p-8">
			<h1 className="text-3xl font-bold">Something went wrong</h1>
			<Button onClick={reset}>Try again</Button>
		</main>
	);
}
