export function LabeledCard({
	title,
	children,
}: {
	title: React.ReactNode;
	children: React.ReactNode;
}) {
	return (
		<div className="bg-input flex flex-col gap-1 rounded-2xl px-6 py-4">
			<span className="text-foreground font-semibold">{title}</span>
			{children}
		</div>
	);
}
