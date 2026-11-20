import { headers } from "next/headers";
import { AuthBanner } from "~/app/login/_components/auth-banner";
import { SignInButton } from "~/app/login/_components/sign-in-button";
import { resolveAuthErrorMessage } from "~/app/login/auth-error-messages";
import { resolveSafeRedirect } from "~/app/login/safe-redirect";
import { signIn } from "~/server/auth";

export default async function LoginPage({
	searchParams,
}: {
	searchParams: Promise<{
		error?: string;
		callbackUrl?: string;
		signedOut?: string;
	}>;
}) {
	const { error, callbackUrl, signedOut } = await searchParams;
	const errorMessage = resolveAuthErrorMessage(error);

	// Proxy-aware, same reasoning this app's AUTH_TRUST_HOST already relies
	// on (see server/auth/config.ts's comment on that env var) — derives the
	// same-origin baseline resolveSafeRedirect checks callbackUrl against.
	const requestHeaders = await headers();
	const protocol = requestHeaders.get("x-forwarded-proto") ?? "https";
	const host =
		requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
	const currentOrigin = `${protocol}://${host}`;

	return (
		<main className="text-foreground flex min-h-screen flex-col items-center justify-center p-4">
			<div className="bg-card border-border text-card-foreground flex w-full max-w-md flex-col items-center gap-6 rounded-xl border p-8 shadow-sm">
				<div className="flex flex-col items-center gap-2 text-center">
					<h1 className="text-2xl font-bold">Swarm Arena</h1>
					<p className="text-muted-foreground text-sm">Sign in to continue</p>
				</div>
				{errorMessage ? (
					<AuthBanner tone="error">{errorMessage}</AuthBanner>
				) : signedOut === "1" ? (
					<AuthBanner tone="info">You&apos;ve been signed out.</AuthBanner>
				) : null}
				<form
					action={async () => {
						"use server";
						const redirectTo = resolveSafeRedirect(
							callbackUrl,
							currentOrigin,
							"/dashboard",
						);
						await signIn("github", { redirectTo });
					}}
					className="w-full"
				>
					<SignInButton />
				</form>
			</div>
		</main>
	);
}
