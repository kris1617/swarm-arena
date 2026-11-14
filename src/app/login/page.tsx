import { signIn } from "~/server/auth";

export default function LoginPage() {
	return (
		<main className="from-primary to-background text-foreground flex min-h-screen flex-col items-center justify-center bg-gradient-to-b">
			<div className="flex flex-col items-center gap-6">
				<h1 className="text-4xl font-bold">Swarm Arena</h1>
				<p className="text-lg">Sign in to continue</p>
				<form
					action={async () => {
						"use server";
						// Without an explicit redirectTo, next-auth sends you back to
						// wherever signIn() was called from — i.e. this /login page
						// itself — which middleware excludes from the gate, so you'd
						// never actually land on the app after a successful sign-in.
						await signIn("github", { redirectTo: "/dashboard" });
					}}
				>
					<button
						className="bg-input text-foreground hover:bg-foreground/35 rounded-full px-10 py-3 font-semibold no-underline transition"
						type="submit"
					>
						Sign in with GitHub
					</button>
				</form>
			</div>
		</main>
	);
}
