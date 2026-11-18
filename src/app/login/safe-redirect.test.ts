import { describe, expect, it } from "vitest";
import { resolveSafeRedirect } from "~/app/login/safe-redirect";

const ORIGIN = "https://example.com";

describe("resolveSafeRedirect", () => {
	it("accepts a same-origin relative path unchanged", () => {
		expect(resolveSafeRedirect("/dashboard", ORIGIN, "/fallback")).toBe(
			"/dashboard",
		);
	});

	it("accepts a same-origin absolute URL and normalizes it to a relative path", () => {
		expect(
			resolveSafeRedirect(
				"https://example.com/runs/42?tab=overview",
				ORIGIN,
				"/fallback",
			),
		).toBe("/runs/42?tab=overview");
	});

	it("rejects a protocol-relative URL", () => {
		expect(resolveSafeRedirect("//evil.com", ORIGIN, "/fallback")).toBe(
			"/fallback",
		);
	});

	it("rejects a cross-origin absolute URL", () => {
		expect(
			resolveSafeRedirect("https://evil.com/phish", ORIGIN, "/fallback"),
		).toBe("/fallback");
	});

	it("rejects malformed input", () => {
		expect(resolveSafeRedirect("http://", ORIGIN, "/fallback")).toBe(
			"/fallback",
		);
	});

	it("falls back when input is undefined", () => {
		expect(resolveSafeRedirect(undefined, ORIGIN, "/fallback")).toBe(
			"/fallback",
		);
	});

	it("takes the first element of an array input", () => {
		expect(
			resolveSafeRedirect(["/dashboard", "/other"], ORIGIN, "/fallback"),
		).toBe("/dashboard");
	});
});
