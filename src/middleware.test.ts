import { describe, expect, it } from "vitest";

import { config } from "~/middleware";

// `config.matcher[0]` is a Next.js middleware matcher *source string*
// (path-to-regexp-style syntax with a named negative-lookahead group), not a
// raw JS RegExp we can test directly. We extract the lookahead's alternation
// list straight out of the exported matcher string and build a JS RegExp
// from it, so this test fails if someone edits the matcher's alternatives
// without updating the extraction logic along with it.
function extractExcludedAlternation(matcherSource: string): string {
	const match = /\(\?!([^)]*)\)/.exec(matcherSource);
	if (!match?.[1]) {
		throw new Error(
			`could not find a negative-lookahead group in matcher: ${matcherSource}`,
		);
	}
	return match[1];
}

const matcherSource = config.matcher[0];
if (!matcherSource) {
	throw new Error("config.matcher is empty");
}
const excludedAlternation = extractExcludedAlternation(matcherSource);
const isExcludedPath = new RegExp(`^/(${excludedAlternation})`);

describe("middleware matcher", () => {
	it.each([
		"/favicon.ico",
		"/google09b7bdc2b7ba546d.html",
		"/robots.txt",
		"/some.file.with.dots.json",
	])("excludes static-file-shaped path %s from the auth gate", (path) => {
		expect(isExcludedPath.test(path)).toBe(true);
	});

	it.each([
		"/login",
		"/api/auth/callback/github",
		"/api/test-auth/login",
		"/_next/static/x.js",
		"/_next/image",
	])("still excludes already-named path %s from the auth gate", (path) => {
		expect(isExcludedPath.test(path)).toBe(true);
	});

	it.each(["/dashboard", "/simulation", "/admin/settings", "/runs/42", "/"])(
		"still gates app route %s behind auth",
		(path) => {
			expect(isExcludedPath.test(path)).toBe(false);
		},
	);
});
