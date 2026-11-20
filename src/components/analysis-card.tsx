export function AnalysisCard({
	title,
	children,
}: {
	title?: React.ReactNode;
	children: React.ReactNode;
}) {
	return (
		<section className="bg-input text-foreground flex w-full max-w-2xl flex-col gap-2 rounded-2xl px-4 py-3">
			{title ? <h2 className="font-semibold">{title}</h2> : null}
			{children}
		</section>
	);
}
