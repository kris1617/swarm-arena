import { cn } from "cn";

export function AuthBanner({
	tone,
	children,
}: {
	tone: "error" | "info";
	children: React.ReactNode;
}) {
	return (
		<div
			className={cn(
				"rounded-lg border p-3 text-sm",
				tone === "error" &&
					"bg-destructive/10 text-destructive border-destructive/30",
				tone === "info" && "bg-muted text-muted-foreground border-border",
			)}
		>
			{children}
		</div>
	);
}
