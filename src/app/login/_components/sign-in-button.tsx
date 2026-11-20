"use client";

import { Loader2Icon } from "lucide-react";
import { useFormStatus } from "react-dom";
import { GitHubIcon } from "~/components/icons/github-icon";
import { Button } from "~/components/ui/button";

export function SignInButton() {
	const { pending } = useFormStatus();

	return (
		<Button
			className="w-full"
			disabled={pending}
			size="lg"
			type="submit"
			variant="outline"
		>
			{pending ? <Loader2Icon className="animate-spin" /> : <GitHubIcon />}
			{pending ? "Redirecting…" : "Continue with GitHub"}
		</Button>
	);
}
