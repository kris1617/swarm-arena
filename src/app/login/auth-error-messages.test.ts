import { describe, expect, it } from "vitest";
import { resolveAuthErrorMessage } from "~/app/login/auth-error-messages";

describe("resolveAuthErrorMessage", () => {
	it("maps AccessDenied to its specific message", () => {
		expect(resolveAuthErrorMessage("AccessDenied")).toBe(
			"GitHub denied access to this account.",
		);
	});

	it("maps Configuration to its specific message", () => {
		expect(resolveAuthErrorMessage("Configuration")).toBe(
			"There's a problem with the sign-in configuration.",
		);
	});

	it("maps OAuthSignInError to its specific message", () => {
		expect(resolveAuthErrorMessage("OAuthSignInError")).toBe(
			"Couldn't start sign-in with GitHub. Please try again.",
		);
	});

	it("maps OAuthCallbackError to its specific message", () => {
		expect(resolveAuthErrorMessage("OAuthCallbackError")).toBe(
			"GitHub sign-in failed. Please try again.",
		);
	});

	it("maps OAuthAccountNotLinked to its specific message", () => {
		expect(resolveAuthErrorMessage("OAuthAccountNotLinked")).toBe(
			"This GitHub account is linked to a different sign-in method.",
		);
	});

	it("maps CallbackRouteError to its specific message", () => {
		expect(resolveAuthErrorMessage("CallbackRouteError")).toBe(
			"Sign-in failed. Please try again.",
		);
	});

	it("maps MissingCSRF to its specific message", () => {
		expect(resolveAuthErrorMessage("MissingCSRF")).toBe(
			"Your sign-in session expired. Please try again.",
		);
	});

	it("maps AccountNotLinked to its specific message", () => {
		expect(resolveAuthErrorMessage("AccountNotLinked")).toBe(
			"This GitHub account is linked to a different sign-in method.",
		);
	});

	it("falls back to a generic message for an unrecognized code", () => {
		expect(resolveAuthErrorMessage("SomeUnknownCode")).toBe(
			"Something went wrong signing in. Please try again.",
		);
	});

	it("returns null when code is undefined", () => {
		expect(resolveAuthErrorMessage(undefined)).toBe(null);
	});

	it("takes the first element of an array input", () => {
		expect(resolveAuthErrorMessage(["AccessDenied", "Other"])).toBe(
			"GitHub denied access to this account.",
		);
	});
});
