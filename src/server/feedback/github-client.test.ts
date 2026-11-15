import { describe, expect, it, vi } from "vitest";

import {
	createGithubIssue,
	formatIssueTitle,
	GithubApiError,
	mapCategoryToGithubLabel,
} from "~/server/feedback/github-client";

function makeFakeFetch(response: {
	ok: boolean;
	status: number;
	json?: () => Promise<unknown>;
	text?: () => Promise<string>;
}) {
	return vi.fn().mockResolvedValue({
		ok: response.ok,
		status: response.status,
		json: response.json ?? (async () => ({})),
		text: response.text ?? (async () => ""),
	});
}

describe("createGithubIssue", () => {
	it("sends the correct URL, method, headers, and JSON body", async () => {
		const fakeFetch = makeFakeFetch({
			ok: true,
			status: 201,
			json: async () => ({ number: 42, html_url: "https://example.com/42" }),
		});

		await createGithubIssue(
			{
				token: "tok-123",
				owner: "kris1617",
				repo: "swarm-arena",
				title: "[Bug] Something broke",
				body: "Description here",
				labels: ["bug"],
			},
			fakeFetch,
		);

		expect(fakeFetch).toHaveBeenCalledTimes(1);
		const [url, init] = fakeFetch.mock.calls[0] as [string, RequestInit];
		expect(url).toBe(
			"https://api.github.com/repos/kris1617/swarm-arena/issues",
		);
		expect(init.method).toBe("POST");
		expect(init.headers).toEqual({
			Authorization: "Bearer tok-123",
			Accept: "application/vnd.github+json",
			"X-GitHub-Api-Version": "2022-11-28",
			"User-Agent": "swarm-arena-feedback-bot",
			"Content-Type": "application/json",
		});
		expect(init.body).toBe(
			JSON.stringify({
				title: "[Bug] Something broke",
				body: "Description here",
				labels: ["bug"],
			}),
		);
	});

	it("resolves to {issueNumber, issueUrl} on a successful response", async () => {
		const fakeFetch = makeFakeFetch({
			ok: true,
			status: 201,
			json: async () => ({
				number: 7,
				html_url: "https://github.com/kris1617/swarm-arena/issues/7",
			}),
		});

		const result = await createGithubIssue(
			{
				token: "tok",
				owner: "kris1617",
				repo: "swarm-arena",
				title: "t",
				body: "b",
				labels: [],
			},
			fakeFetch,
		);

		expect(result).toEqual({
			issueNumber: 7,
			issueUrl: "https://github.com/kris1617/swarm-arena/issues/7",
		});
	});

	it("rejects with GithubApiError carrying status/body on a non-ok response", async () => {
		const fakeFetch = makeFakeFetch({
			ok: false,
			status: 401,
			text: async () => '{"message":"Bad credentials"}',
		});

		await expect(
			createGithubIssue(
				{
					token: "bad-token",
					owner: "kris1617",
					repo: "swarm-arena",
					title: "t",
					body: "b",
					labels: [],
				},
				fakeFetch,
			),
		).rejects.toSatisfy((error: unknown) => {
			expect(error).toBeInstanceOf(GithubApiError);
			expect((error as GithubApiError).status).toBe(401);
			expect((error as GithubApiError).body).toBe(
				'{"message":"Bad credentials"}',
			);
			return true;
		});
	});
});

describe("mapCategoryToGithubLabel", () => {
	it("maps bug -> bug and idea -> enhancement", () => {
		expect(mapCategoryToGithubLabel("bug")).toBe("bug");
		expect(mapCategoryToGithubLabel("idea")).toBe("enhancement");
	});
});

describe("formatIssueTitle", () => {
	it("prefixes the title with [Bug] or [Idea]", () => {
		expect(formatIssueTitle("bug", "X")).toBe("[Bug] X");
		expect(formatIssueTitle("idea", "X")).toBe("[Idea] X");
	});
});
