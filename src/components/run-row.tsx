import { cn } from "cn";
import Link from "next/link";
import type * as React from "react";
import { Button } from "~/components/ui/button";

function RunRow({
	className,
	leading,
	label,
	trailing,
	actionHref,
	actionLabel,
}: {
	className?: string;
	leading?: React.ReactNode;
	label: React.ReactNode;
	trailing?: React.ReactNode;
	actionHref: string;
	actionLabel: string;
}) {
	return (
		<div
			className={cn(
				"bg-background flex items-center justify-between gap-2 rounded-full px-4 py-2",
				className,
			)}
		>
			{leading}
			{label}
			{trailing}
			<Button
				asChild
				className="hover:bg-foreground/15 h-auto rounded-full px-4 py-1 font-semibold"
			>
				<Link href={actionHref}>{actionLabel}</Link>
			</Button>
		</div>
	);
}

export { RunRow };
