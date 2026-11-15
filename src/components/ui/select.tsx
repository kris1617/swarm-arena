import { cn } from "cn";
import type * as React from "react";

function Select({
	className,
	children,
	...props
}: React.ComponentProps<"select">) {
	return (
		<select
			className={cn(
				"bg-input text-foreground focus-visible:border-ring focus-visible:ring-ring/50 disabled:bg-input/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 h-auto rounded-full border-0 px-4 py-2 text-base transition-colors outline-none focus-visible:ring-3 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:ring-3 md:text-sm",
				className,
			)}
			data-slot="select"
			{...props}
		>
			{children}
		</select>
	);
}

export { Select };
