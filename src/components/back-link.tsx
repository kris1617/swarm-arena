import Link from "next/link";

export function BackLink() {
	return (
		<Link
			className="text-foreground hover:text-muted-foreground underline"
			href="/reference"
		>
			← Back to Reference
		</Link>
	);
}
