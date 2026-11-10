import { signIn } from "~/server/auth";

export default function LoginPage() {
	return (
		<main className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-[#2e026d] to-[#15162c] text-white">
			<div className="flex flex-col items-center gap-6">
				<h1 className="text-3xl font-bold">Sign in</h1>
				<form
					action={async () => {
						"use server";
						// Without an explicit redirectTo, next-auth sends you back to
						// wherever signIn() was called from — i.e. this /login page
						// itself — which middleware excludes from the gate, so you'd
						// never actually land on the app after a successful sign-in.
						await signIn("github", { redirectTo: "/" });
					}}
				>
					<button
						className="rounded-full bg-white/10 px-10 py-3 font-semibold no-underline transition hover:bg-white/20"
						type="submit"
					>
						Sign in with GitHub
					</button>
				</form>
			</div>
		</main>
	);
}
