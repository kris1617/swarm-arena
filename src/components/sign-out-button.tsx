"use client";

import { useFormStatus } from "react-dom";
import { Button } from "~/components/ui/button";

export function SignOutButton() {
	const { pending } = useFormStatus();

	return (
		<Button disabled={pending} type="submit" variant="destructive">
			{pending ? "Signing out…" : "Sign out"}
		</Button>
	);
}
