"use client";

import { useEffect } from "react";

import { Button } from "~/components/ui/button";

export default function ErrorBoundary({
	error,
	retry,
}: {
	error: Error & { digest?: string };
	// `retry` (stable since Next 16.3.0) re-fetches and re-renders the
	// boundary's children, unlike `reset` which only clears local error
	// state — see node_modules/next/dist/docs/.../error.md.
	retry: () => void;
}) {
	useEffect(() => {
		console.error(error);
	}, [error]);

	return (
		<main className="from-primary to-background text-foreground flex min-h-screen flex-col items-center justify-center gap-8 bg-gradient-to-b p-8">
			<h1 className="text-3xl font-bold">Something went wrong</h1>
			<Button onClick={() => retry()}>Try again</Button>
		</main>
	);
}
