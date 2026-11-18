"use client";

import { useFormStatus } from "react-dom";
import { GitHubIcon } from "~/components/icons/github-icon";
import { Button } from "~/components/ui/button";

export default function SignInButton() {
	const { pending } = useFormStatus();

	return (
		<Button disabled={pending} size="lg" type="submit">
			<GitHubIcon />
			{pending ? "Redirecting…" : "Continue with GitHub"}
		</Button>
	);
}
