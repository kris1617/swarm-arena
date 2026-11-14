export function StatusMessage({ children }: { children: React.ReactNode }) {
	return (
		<div className="from-primary to-background text-foreground flex min-h-screen flex-col items-center justify-center bg-gradient-to-b p-8">
			<p>{children}</p>
		</div>
	);
}
