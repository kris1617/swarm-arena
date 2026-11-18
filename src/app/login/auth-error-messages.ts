const GENERIC_MESSAGE = "Something went wrong signing in. Please try again.";

/**
 * Maps next-auth's error codes to short, friendly copy instead of showing
 * the raw `?error=` value. Only the error types actually reachable with
 * this app's GitHub-only, no-credentials provider setup are listed here —
 * these are the real v5-beta `@auth/core` names, not v4 legacy ones. Any
 * other/unknown code falls back to a generic message; the raw code is
 * never echoed to the user.
 */
const ERROR_MESSAGES: Record<string, string> = {
	Configuration: "There's a problem with the sign-in configuration.",
	OAuthSignInError: "Couldn't start sign-in with GitHub. Please try again.",
	OAuthCallbackError: "GitHub sign-in failed. Please try again.",
	OAuthAccountNotLinked:
		"This GitHub account is linked to a different sign-in method.",
	CallbackRouteError: "Sign-in failed. Please try again.",
	MissingCSRF: "Your sign-in session expired. Please try again.",
	AccountNotLinked:
		"This GitHub account is linked to a different sign-in method.",
	AccessDenied: "GitHub denied access to this account.",
};

export function resolveAuthErrorMessage(
	code: string | string[] | undefined,
): string | null {
	const value = Array.isArray(code) ? code[0] : code;

	if (!value) {
		return null;
	}

	return ERROR_MESSAGES[value] ?? GENERIC_MESSAGE;
}
